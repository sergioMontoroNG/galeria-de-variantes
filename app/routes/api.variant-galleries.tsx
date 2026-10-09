import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

// Endpoint para automatizaciones (n8n). El metafield `$app/gallery` pertenece
// al namespace reservado de esta app, así que solo el token de esta app puede
// escribirlo; un token de otra custom app falla. n8n llama aquí y la app
// escribe con su propia sesión offline.
//
// POST /api/variant-galleries
// Authorization: Bearer <AUTOMATION_API_KEY>
// { "shop": "tienda.myshopify.com",
//   "galleries": [{ "variantId": "gid://shopify/ProductVariant/1",
//                   "mediaIds": ["gid://shopify/MediaImage/2", ...] }] }
// El orden de mediaIds es el orden de la minigalería.
//
// Opcional por galería: "videos": [{ "youtubeId": "<11 caracteres>", "position": 2 }]
// (position = fotos que van antes del vídeo). Si la clave "videos" NO se envía,
// los vídeos que ya tenga la variante no se tocan: n8n solo conoce fotos y un
// reenvío suyo nunca debe borrar los vídeos puestos a mano en la app.
//
// Si se envía además "productId" (gid://shopify/Product/N), la primera foto de
// cada galería pasa a ser la imagen principal (nativa) de la variante. Se hace
// aquí, al final, porque Shopify rechaza asignar una imagen a una variante que
// ya tiene otra, y las fotos antiguas solo desaparecen cuando el flujo termina.

const SAVE_GALLERIES_MUTATION = `#graphql
  mutation SaveVariantGalleries($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const VARIANT_MEDIA_QUERY = `#graphql
  query VariantCurrentMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        media(first: 20) {
          nodes {
            id
          }
        }
      }
    }
  }
`;

const DETACH_VARIANT_MEDIA_MUTATION = `#graphql
  mutation DetachVariantMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
    productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
      userErrors {
        field
        message
      }
    }
  }
`;

const APPEND_VARIANT_MEDIA_MUTATION = `#graphql
  mutation AppendVariantMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
    productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
      userErrors {
        field
        message
      }
    }
  }
`;

const MAX_PER_CALL = 25; // límite de metafieldsSet
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const MEDIA_GID = /^gid:\/\/shopify\/MediaImage\/\d+$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type Video = { youtubeId: string; position: number };
type Gallery = { variantId: string; mediaIds: string[]; videos?: Video[] };
type UserError = { message: string };
type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

// Deja la primera foto de cada galería como única imagen nativa de la variante.
// Devuelve, por variante: "SET", "UNCHANGED" o "ERROR: <motivo>".
async function setNativeImages(
  admin: AdminClient,
  productId: string,
  galleries: Gallery[],
): Promise<Map<string, string>> {
  const status = new Map<string, string>();
  const targets = galleries.filter((g) => g.mediaIds.length > 0);

  for (let i = 0; i < targets.length; i += MAX_PER_CALL) {
    const chunk = targets.slice(i, i + MAX_PER_CALL);
    const fail = (message: string) => {
      for (const g of chunk) status.set(g.variantId, `ERROR: ${message}`);
    };
    try {
      const currentResponse = await admin.graphql(VARIANT_MEDIA_QUERY, {
        variables: { ids: chunk.map((g) => g.variantId) },
      });
      const currentData: { data?: any } = await currentResponse.json();
      if (!currentData.data) {
        fail("no se pudo leer la imagen actual de las variantes");
        continue;
      }
      const current = new Map<string, string[]>(
        (currentData.data.nodes ?? [])
          .filter(Boolean)
          .map((n: { id: string; media?: { nodes?: { id: string }[] } }) => [
            n.id,
            (n.media?.nodes ?? []).map((m) => m.id),
          ]),
      );

      const toDetach: Gallery[] = [];
      const toAppend: Gallery[] = [];
      for (const g of chunk) {
        const first = g.mediaIds[0];
        const have = current.get(g.variantId) ?? [];
        if (have.length === 1 && have[0] === first) {
          status.set(g.variantId, "UNCHANGED");
          continue;
        }
        const others = have.filter((id) => id !== first);
        if (others.length) toDetach.push({ variantId: g.variantId, mediaIds: others });
        if (!have.includes(first)) toAppend.push({ variantId: g.variantId, mediaIds: [first] });
        status.set(g.variantId, "SET");
      }

      for (const [mutation, key, variantMedia] of [
        [DETACH_VARIANT_MEDIA_MUTATION, "productVariantDetachMedia", toDetach],
        [APPEND_VARIANT_MEDIA_MUTATION, "productVariantAppendMedia", toAppend],
      ] as const) {
        if (!variantMedia.length) continue;
        const response = await admin.graphql(mutation, { variables: { productId, variantMedia } });
        const data: { data?: any } = await response.json();
        const userErrors: UserError[] = data.data?.[key]?.userErrors ?? [];
        if (!data.data || userErrors.length) {
          fail(userErrors.map((e) => e.message).join("; ") || `${key} falló`);
          break;
        }
      }
    } catch (e) {
      console.error("variant-galleries: imagen principal falló", e);
      fail(`no se pudo asignar la imagen principal: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    }
  }
  return status;
}

// El prefijo "Bearer " es opcional y se ignoran espacios/saltos de línea en
// ambos lados: pegar la clave en Vercel o en n8n suele arrastrar un "\n".
function isAuthorized(request: Request, expected: string) {
  const header = (request.headers.get("authorization") ?? "").trim();
  const provided = header.replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const expectedKey = process.env.AUTOMATION_API_KEY?.trim();
  // 503 y no 401: distingue "el servidor no tiene la clave" de "la clave no coincide".
  if (!expectedKey) return json({ ok: false, error: "AUTOMATION_API_KEY no configurada en este despliegue" }, 503);
  if (!isAuthorized(request, expectedKey)) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: { shop?: unknown; galleries?: unknown; productId?: unknown };
  try {
    body = await request.json();
  } catch (_e) {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const shop = String(body.shop ?? "");
  if (!SHOP_DOMAIN.test(shop)) return json({ ok: false, error: "shop inválido" }, 400);
  if (!Array.isArray(body.galleries) || body.galleries.length === 0) {
    return json({ ok: false, error: "galleries vacío" }, 400);
  }

  const productId = body.productId == null ? null : String(body.productId);
  if (productId !== null && !PRODUCT_GID.test(productId)) {
    return json({ ok: false, error: "productId inválido" }, 400);
  }

  const galleries = body.galleries as Gallery[];
  for (const g of galleries) {
    if (
      !g ||
      !VARIANT_GID.test(String(g.variantId)) ||
      !Array.isArray(g.mediaIds) ||
      !g.mediaIds.every((id) => MEDIA_GID.test(String(id))) ||
      (g.videos !== undefined &&
        (!Array.isArray(g.videos) ||
          !g.videos.every(
            (v) =>
              v &&
              YOUTUBE_ID.test(String(v.youtubeId)) &&
              Number.isInteger(v.position) &&
              v.position >= 0,
          )))
    ) {
      return json({ ok: false, error: `Entrada inválida para ${g?.variantId}` }, 400);
    }
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (_e) {
    return json({ ok: false, error: `La app no está instalada en ${shop}` }, 404);
  }

  const results: { variantId: string; ok: boolean; userErrors: unknown[]; nativeImage?: string }[] =
    galleries.map((g) => ({ variantId: g.variantId, ok: true, userErrors: [] }));

  // Un metafield por foto-lista y, si se envían, otro por vídeos. El límite de 25
  // de metafieldsSet cuenta metafields, no galerías.
  const inputs = galleries.flatMap((g, galleryIndex) => {
    const base = { ownerId: g.variantId, namespace: "$app" };
    return [
      { galleryIndex, input: { ...base, key: "gallery", type: "list.file_reference", value: JSON.stringify(g.mediaIds) } },
      ...(g.videos === undefined
        ? []
        : [{ galleryIndex, input: { ...base, key: "gallery_videos", type: "json", value: JSON.stringify(g.videos) } }]),
    ];
  });

  for (let i = 0; i < inputs.length; i += MAX_PER_CALL) {
    const chunk = inputs.slice(i, i + MAX_PER_CALL);
    const failChunk = (message: string) => {
      for (const galleryIndex of new Set(chunk.map((c) => c.galleryIndex))) {
        results[galleryIndex].ok = false;
        results[galleryIndex].userErrors.push({ message });
      }
    };
    try {
      const response = await admin.graphql(SAVE_GALLERIES_MUTATION, {
        variables: { metafields: chunk.map((c) => c.input) },
      });
      const data: { data?: any; errors?: unknown } = await response.json();
      const userErrors: { field?: string[] | null; message: string }[] =
        data.data?.metafieldsSet?.userErrors ?? [];
      if (!data.data) {
        // Error a nivel de petición (p. ej. token/scopes): se marca todo el lote.
        failChunk(JSON.stringify(data.errors ?? "sin datos"));
        continue;
      }
      // field = ["metafields", "<índice>", ...]
      for (const error of userErrors) {
        const entry = error.field?.[1] == null ? undefined : chunk[Number(error.field[1])];
        if (entry) {
          results[entry.galleryIndex].ok = false;
          results[entry.galleryIndex].userErrors.push(error);
        } else {
          failChunk(error.message); // error sin índice: no se sabe de quién es
        }
      }
    } catch (e) {
      // El mensaje de Shopify (consulta inválida, token, scopes…) no contiene secretos.
      console.error("variant-galleries: metafieldsSet falló", e);
      const detail = e instanceof Error ? e.message : String(e);
      failChunk(`No se pudo guardar la galería: ${detail.slice(0, 300)}`);
    }
  }

  // Imagen principal solo para las variantes cuya galería se guardó bien. Un fallo
  // aquí no invalida la galería: se informa por variante en `nativeImage`.
  if (productId) {
    const saved = new Set(results.filter((r) => r.ok).map((r) => r.variantId));
    const nativeStatus = await setNativeImages(
      admin,
      productId,
      galleries.filter((g) => saved.has(g.variantId)),
    );
    for (const r of results) {
      const s = nativeStatus.get(r.variantId);
      if (s) r.nativeImage = s;
    }
  }

  const ok = results.every((r) => r.ok);
  return json({ ok, results }, ok ? 200 : 207);
};

// Sin loader: GET devuelve 404/405 y nunca sirve UI.
