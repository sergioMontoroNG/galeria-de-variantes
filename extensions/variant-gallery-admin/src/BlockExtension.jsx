import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

export default async () => {
  render(<Extension />, document.body);
};

const GALLERY_QUERY = `
  query VariantGallery($variantId: ID!) {
    productVariant(id: $variantId) {
      id
      product {
        id
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

const SAVE_GALLERY_MUTATION = `
  mutation SaveVariantGallery($variantId: ID!, $value: String!) {
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

function Extension() {
  const variantId = shopify.data.selected?.[0]?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productImages, setProductImages] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const {data} = await shopify.query(GALLERY_QUERY, {
          variables: {variantId},
        });
        if (cancelled) return;

        const images = (data?.productVariant?.product?.media?.nodes ?? [])
          .filter((node) => node.mediaContentType === 'IMAGE' && node.image)
          .map((node) => ({
            id: node.id,
            url: node.image.url,
            alt: node.image.altText ?? '',
          }));
        setProductImages(images);

        const current = data?.productVariant?.galleryMetafield?.jsonValue;
        setSelectedIds(Array.isArray(current) ? current : []);
      } catch (_e) {
        if (!cancelled) {
          setError('No se pudo cargar la galería de esta variante.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (variantId) load();
    return () => {
      cancelled = true;
    };
  }, [variantId]);

  function toggleImage(id) {
    setSaved(false);
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  }

  function moveImage(id, direction) {
    setSaved(false);
    setSelectedIds((prev) => {
      const index = prev.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const {data} = await shopify.query(SAVE_GALLERY_MUTATION, {
        variables: {
          variantId,
          value: JSON.stringify(selectedIds),
        },
      });
      const userErrors = data?.metafieldsSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        setError(userErrors.map((userError) => userError.message).join(' '));
      } else {
        setSaved(true);
      }
    } catch (_e) {
      setError('No se pudo guardar la galería de esta variante.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <s-admin-block heading="Mini galería de variante">
        <s-spinner accessibilityLabel="Cargando galería" />
      </s-admin-block>
    );
  }

  const orderedSelected = selectedIds
    .map((id) => productImages.find((img) => img.id === id))
    .filter(Boolean);

  return (
    <s-admin-block heading="Mini galería de variante">
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {saved && <s-banner tone="success">Galería guardada.</s-banner>}

        <s-text tone="subdued">
          Elige qué imágenes del producto forman parte de la galería de esta
          variante y ordénalas con las flechas. Si dejas solo 1 imagen, en la
          tienda se mostrarán todas las imágenes del producto pero con esta
          priorizada en primer lugar.
        </s-text>

        {orderedSelected.length > 0 && (
          <s-stack direction="block" gap="tight">
            <s-text type="strong">Orden de la mini galería</s-text>
            {orderedSelected.map((img, index) => (
              <s-stack key={img.id} direction="inline" gap="tight" alignItems="center">
                <s-thumbnail src={img.url} alt={img.alt} size="small" />
                <s-text>{index + 1}</s-text>
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
              </s-stack>
            ))}
          </s-stack>
        )}

        <s-stack direction="block" gap="tight">
          <s-text type="strong">Imágenes del producto</s-text>
          {productImages.length === 0 && (
            <s-text tone="subdued">Este producto todavía no tiene imágenes.</s-text>
          )}
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(48px, 1fr))" gap="tight">
            {productImages.map((img) => (
              <s-stack key={img.id} direction="block" gap="extra-tight" alignItems="center">
                <s-thumbnail src={img.url} alt={img.alt} size="small" />
                <s-checkbox
                  checked={selectedIds.includes(img.id)}
                  onChange={() => toggleImage(img.id)}
                  accessibilityLabel={img.alt || 'Incluir imagen en la galería'}
                />
              </s-stack>
            ))}
          </s-grid>
        </s-stack>

        <s-button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
          Guardar
        </s-button>
      </s-stack>
    </s-admin-block>
  );
}
