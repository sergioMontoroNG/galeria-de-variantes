import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// This page replaces the old admin block-extension editor. Admin blocks are
// capped to a fixed height with no internal scrolling, so a variant with
// several gallery images pushed the "Guardar" button and the rest of the
// picker off-screen with no way to reach it. A full app page scrolls like
// any other admin page, so that ceiling doesn't exist here.
//
// This route deliberately lives at a real sub-path (not the `/app` index).
// An index route shares its URL with its parent layout, and React Router's
// single-fetch data layer ended up treating `fetcher.load("/app?variantId=…")`
// as a no-op revalidation of the already-loaded index data instead of a
// fresh request — the request never even reached the server. A distinct
// path sidesteps that ambiguity. `/app` just redirects here.

const VARIANT_GALLERY_QUERY = `#graphql
  query VariantGalleryPage($variantId: ID!) {
    productVariant(id: $variantId) {
      id
      title
      legacyResourceId
      media(first: 1) {
        nodes {
          mediaContentType
          ... on MediaImage {
            image {
              url
              altText
            }
          }
        }
      }
      product {
        id
        title
        onlineStorePreviewUrl
        variants(first: 250) {
          nodes {
            id
            title
          }
        }
        media(first: 250) {
          nodes {
            id
            mediaContentType
            ... on MediaImage {
              image {
                url
                altText
              }
            }
          }
        }
      }
      galleryMetafield: metafield(namespace: "$app", key: "gallery") {
        jsonValue
      }
    }
  }
`;

const SAVE_VARIANT_GALLERY_MUTATION = `#graphql
  mutation SaveVariantGalleryPage($variantId: ID!, $value: String!) {
    metafieldsSet(metafields: [{
      ownerId: $variantId,
      namespace: "$app",
      key: "gallery",
      type: "list.file_reference",
      value: $value
    }]) {
      userErrors {
        field
        message
      }
    }
  }
`;

type GalleryImage = { id: string; url: string; alt: string };
type SiblingVariant = { id: string; title: string };

type VariantGallery = {
  id: string;
  title: string;
  productTitle: string;
  image: GalleryImage | null;
  images: GalleryImage[];
  selectedIds: string[];
  storeUrl: string | null;
  siblingVariants: SiblingVariant[];
};

async function loadVariantGallery(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  variantId: string,
): Promise<VariantGallery | null> {
  const response = await admin.graphql(VARIANT_GALLERY_QUERY, {
    variables: { variantId },
  });
  const json = await response.json();
  const variant = json.data?.productVariant;
  if (!variant) return null;

  type MediaNode = {
    id: string;
    mediaContentType: string;
    image?: { url: string; altText: string | null } | null;
  };

  const images: GalleryImage[] = ((variant.product?.media?.nodes ?? []) as MediaNode[])
    .filter((node) => node.mediaContentType === "IMAGE" && node.image)
    .map((node) => ({
      id: node.id,
      url: node.image!.url,
      alt: node.image!.altText ?? "",
    }));

  const selectedIds = Array.isArray(variant.galleryMetafield?.jsonValue)
    ? variant.galleryMetafield.jsonValue
    : [];

  type VariantMediaNode = {
    mediaContentType: string;
    image?: { url: string; altText: string | null } | null;
  };

  const ownImageNode = ((variant.media?.nodes ?? []) as VariantMediaNode[]).find(
    (node) => node.mediaContentType === "IMAGE" && node.image,
  );
  const image: GalleryImage | null = ownImageNode
    ? {
        id: variant.id,
        url: ownImageNode.image!.url,
        alt: ownImageNode.image!.altText ?? "",
      }
    : null;

  const previewUrl: string | null = variant.product?.onlineStorePreviewUrl ?? null;
  const storeUrl =
    previewUrl && variant.legacyResourceId
      ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}variant=${variant.legacyResourceId}`
      : previewUrl;

  const siblingVariants: SiblingVariant[] = (variant.product?.variants?.nodes ?? []).map(
    (node: { id: string; title: string }) => ({ id: node.id, title: node.title }),
  );

  return {
    id: variant.id,
    title: variant.title,
    productTitle: variant.product.title,
    image,
    images,
    selectedIds,
    storeUrl,
    siblingVariants,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const variantId = url.searchParams.get("variantId");
  if (!variantId) return { variant: null, error: null };

  try {
    const variant = await loadVariantGallery(admin, variantId);
    return {
      variant,
      error: variant ? null : "No se pudo cargar la galería de esta variante.",
    };
  } catch (_e) {
    return { variant: null, error: "No se pudo cargar la galería de esta variante." };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const variantId = String(formData.get("variantId") ?? "");
  const value = String(formData.get("value") ?? "[]");

  try {
    const response = await admin.graphql(SAVE_VARIANT_GALLERY_MUTATION, {
      variables: { variantId, value },
    });
    const json = await response.json();
    const userErrors = json.data?.metafieldsSet?.userErrors ?? [];
    return { ok: userErrors.length === 0, userErrors, variantId };
  } catch (_e) {
    return {
      ok: false,
      userErrors: [{ message: "No se pudo guardar la galería de esta variante." }],
      variantId,
    };
  }
};

type RecentVariant = { id: string; title: string; productTitle: string };

export default function GaleriaDeVariantes() {
  const shopify = useAppBridge();
  const loadFetcher = useFetcher<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [recent, setRecent] = useState<RecentVariant[]>([]);

  const variant = loadFetcher.data?.variant ?? null;
  const loadError = loadFetcher.data?.error ?? null;
  const isLoadingVariant = loadFetcher.state !== "idle";

  useEffect(() => {
    if (!variant) return;
    setSelectedIds(variant.selectedIds);
    setRecent((prev) => {
      const withoutCurrent = prev.filter((entry) => entry.id !== variant.id);
      return [
        { id: variant.id, title: variant.title, productTitle: variant.productTitle },
        ...withoutCurrent,
      ].slice(0, 8);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data) return;
    if (saveFetcher.data.ok) {
      shopify.toast.show("Galería guardada.");
    } else {
      const message =
        saveFetcher.data.userErrors
          ?.map((userError: { message: string }) => userError.message)
          .join(" ") ||
        "No se pudo guardar la galería de esta variante.";
      shopify.toast.show(message, { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data, saveFetcher.state]);

  function openVariant(variantId: string) {
    loadFetcher.load(`/app/galeria?variantId=${encodeURIComponent(variantId)}`);
  }

  async function pickVariant() {
    // type: "product" (not "variant") so the picker's search/browse list
    // shows product names, not just bare variant option combos — with
    // filter.variants it still lets you drill in and pick a variant.
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      filter: { variants: true },
    });
    if (!selection?.length) return; // picker closed/cancelled

    const picked = selection[0]?.variants?.[0];
    if (!picked?.id) {
      shopify.toast.show(
        "Dentro del producto, marca también la variante concreta antes de confirmar.",
        { isError: true },
      );
      return;
    }
    openVariant(picked.id);
  }

  function toggleImage(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  }

  function moveImage(id: string, direction: number) {
    setSelectedIds((prev) => {
      const index = prev.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleSave() {
    if (!variant) return;
    saveFetcher.submit(
      { variantId: variant.id, value: JSON.stringify(selectedIds) },
      { method: "POST" },
    );
  }

  const productImages = variant?.images ?? [];
  const orderedSelected = selectedIds
    .map((id) => productImages.find((img) => img.id === id))
    .filter((img): img is GalleryImage => Boolean(img));
  const saving = saveFetcher.state !== "idle";

  return (
    <s-page heading="Galería de variantes">
      <s-button slot="primary-action" onClick={pickVariant}>
        {variant ? "Elegir otra variante" : "Elegir variante"}
      </s-button>

      {!variant && !isLoadingVariant && (
        <s-section heading="Selecciona una variante">
          {loadError && <s-banner tone="critical">{loadError}</s-banner>}
          <s-paragraph>
            Elige una variante del catálogo para configurar las imágenes de su
            mini galería.
          </s-paragraph>
        </s-section>
      )}

      {isLoadingVariant && !variant && (
        <s-section heading="Cargando variante">
          <s-spinner accessibilityLabel="Cargando galería" />
        </s-section>
      )}

      {variant && (
        <s-section heading={`${variant.productTitle}: ${variant.title}`}>
          <s-stack direction="block" gap="base">
            {loadError && <s-banner tone="critical">{loadError}</s-banner>}

            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
                Guardar
              </s-button>
              {variant.storeUrl && (
                <s-button href={variant.storeUrl} target="_blank" variant="tertiary">
                  Ver variante en la tienda
                </s-button>
              )}
            </s-stack>

            {variant.image && (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-thumbnail src={variant.image.url} alt={variant.image.alt} size="base" />
                <s-text color="subdued">Foto actual de la variante</s-text>
              </s-stack>
            )}

            <s-text color="subdued">
              Elige qué imágenes del producto forman parte de la galería de
              esta variante y ordénalas con las flechas. Con 2 o más
              imágenes, en la tienda se mostrará primero la imagen principal
              de la variante seguida de estas. Si dejas solo 1, se mostrarán
              todas las imágenes del producto pero con esta priorizada en
              primer lugar.
            </s-text>

            {orderedSelected.length > 0 && (
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">Orden de la mini galería</s-text>
                <s-grid gridTemplateColumns="repeat(auto-fill, minmax(96px, 1fr))" gap="small-200">
                  {orderedSelected.map((img, index) => (
                    <s-box
                      key={img.id}
                      padding="small-200"
                      borderRadius="small"
                      borderWidth="small-100"
                      borderColor="subdued"
                      background="subdued"
                    >
                      <s-stack direction="block" gap="small-200" alignItems="center">
                        <s-thumbnail src={img.url} alt={img.alt} size="small" />
                        <s-text>{index + 1}</s-text>
                        <s-stack direction="inline" gap="small-200">
                          <s-button
                            disabled={index === 0}
                            onClick={() => moveImage(img.id, -1)}
                            accessibilityLabel="Subir"
                          >
                            ↑
                          </s-button>
                          <s-button
                            disabled={index === orderedSelected.length - 1}
                            onClick={() => moveImage(img.id, 1)}
                            accessibilityLabel="Bajar"
                          >
                            ↓
                          </s-button>
                          <s-button
                            onClick={() => toggleImage(img.id)}
                            accessibilityLabel="Quitar de la galería"
                            tone="critical"
                          >
                            ×
                          </s-button>
                        </s-stack>
                      </s-stack>
                    </s-box>
                  ))}
                </s-grid>
              </s-stack>
            )}

            <s-stack direction="block" gap="small">
              <s-text type="strong">Imágenes del producto</s-text>
              {productImages.length === 0 && (
                <s-text color="subdued">Este producto todavía no tiene imágenes.</s-text>
              )}
              <s-grid gridTemplateColumns="repeat(auto-fill, minmax(64px, 1fr))" gap="small-200">
                {productImages.map((img) => {
                  const selected = selectedIds.includes(img.id);
                  return (
                    <s-clickable
                      key={img.id}
                      onClick={() => toggleImage(img.id)}
                      accessibilityLabel={
                        img.alt || (selected ? "Quitar de la galería" : "Incluir en la galería")
                      }
                      padding="small-200"
                      borderRadius="small"
                      borderWidth={selected ? "large" : "small-100"}
                      borderColor={selected ? "strong" : "subdued"}
                      background={selected ? "subdued" : "transparent"}
                    >
                      <s-thumbnail src={img.url} alt={img.alt} size="small" />
                    </s-clickable>
                  );
                })}
              </s-grid>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {variant && variant.siblingVariants.length > 1 && (
        <s-section slot="aside" heading={`Variantes de ${variant.productTitle}`}>
          <s-stack direction="block" gap="small">
            {variant.siblingVariants.map((sibling) => (
              <s-button
                key={sibling.id}
                variant="tertiary"
                disabled={variant.id === sibling.id}
                onClick={() => openVariant(sibling.id)}
              >
                {sibling.title}
              </s-button>
            ))}
          </s-stack>
        </s-section>
      )}

      {recent.length > 0 && (
        <s-section slot="aside" heading="Editadas recientemente">
          <s-stack direction="block" gap="small">
            {recent.map((entry) => (
              <s-button
                key={entry.id}
                variant="tertiary"
                disabled={variant?.id === entry.id}
                onClick={() => openVariant(entry.id)}
              >
                {`${entry.productTitle}: ${entry.title}`}
              </s-button>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
