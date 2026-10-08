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

const SAVE_GALLERIES_MUTATION = `#graphql
  mutation SaveVariantGalleries($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        ownerId
      }
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
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type Gallery = { variantId: string; mediaIds: string[] };

function isAuthorized(request: Request) {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!isAuthorized(request)) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: { shop?: unknown; galleries?: unknown };
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

  const galleries = body.galleries as Gallery[];
  for (const g of galleries) {
    if (
      !g ||
      !VARIANT_GID.test(String(g.variantId)) ||
      !Array.isArray(g.mediaIds) ||
      !g.mediaIds.every((id) => MEDIA_GID.test(String(id)))
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

  const results: { variantId: string; ok: boolean; userErrors: unknown[] }[] = [];
  for (let i = 0; i < galleries.length; i += MAX_PER_CALL) {
    const chunk = galleries.slice(i, i + MAX_PER_CALL);
    const metafields = chunk.map((g) => ({
      ownerId: g.variantId,
      namespace: "$app",
      key: "gallery",
      type: "list.file_reference",
      value: JSON.stringify(g.mediaIds),
    }));
    try {
      const response = await admin.graphql(SAVE_GALLERIES_MUTATION, {
        variables: { metafields },
      });
      const data: { data?: any; errors?: unknown } = await response.json();
      const userErrors: { field?: string[] | null; message: string }[] =
        data.data?.metafieldsSet?.userErrors ?? [];
      if (!data.data) {
        // Error a nivel de petición (p. ej. token/scopes): se marca todo el lote.
        for (const g of chunk) {
          results.push({ variantId: g.variantId, ok: false, userErrors: [{ message: JSON.stringify(data.errors ?? "sin datos") }] });
        }
        continue;
      }
      // field = ["metafields", "<índice>", ...]
      for (const [idx, g] of chunk.entries()) {
        const own = userErrors.filter((e) => e.field?.[1] === String(idx));
        results.push({ variantId: g.variantId, ok: own.length === 0 && userErrors.every((e) => e.field?.[1] != null), userErrors: own });
      }
    } catch (_e) {
      for (const g of chunk) {
        results.push({
          variantId: g.variantId,
          ok: false,
          userErrors: [{ message: "No se pudo guardar la galería" }],
        });
      }
    }
  }

  const ok = results.every((r) => r.ok);
  return json({ ok, results }, ok ? 200 : 207);
};

// Sin loader: GET devuelve 404/405 y nunca sirve UI.
