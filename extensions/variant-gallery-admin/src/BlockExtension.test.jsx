import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/preact";

// BlockExtension only exports a default `() => render(<Extension/>, document.body)`
// (the inner `Extension` component isn't exported), so each test drives the
// real mount entrypoint and asserts against the resulting DOM - the same
// surface the Shopify admin host actually renders.
async function mount() {
  vi.resetModules();
  const mod = await import("./BlockExtension.jsx");
  await mod.default();
}

// The `s-*` tags are Shopify's admin UI extension web components. They are
// unregistered custom elements in jsdom, so testing-library's role/label
// queries (which rely on real ARIA semantics) can't see them - props like
// `accessibilityLabel` land as a plain lowercase attribute, not `aria-label`.
// Querying by tag/attribute directly is the reliable way to reach them.
const checkboxes = () => Array.from(document.querySelectorAll("s-checkbox"));
const buttonsLabelled = (label) =>
  Array.from(document.querySelectorAll(`s-button[accessibilitylabel="${label}"]`));
const isDisabled = (el) => el.getAttribute("disabled") === "true";

function image(id, url = `https://cdn.shopify.com/${id}.jpg`, alt = "") {
  return { id, mediaContentType: "IMAGE", image: { url, altText: alt } };
}

function queryResponse({ mediaNodes = [], gallery = [] } = {}) {
  return {
    data: {
      productVariant: {
        id: "gid://shopify/ProductVariant/1",
        product: { id: "gid://shopify/Product/1", media: { nodes: mediaNodes } },
        galleryMetafield: { jsonValue: gallery },
      },
    },
  };
}

describe("BlockExtension (admin mini-gallery editor)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    globalThis.shopify = {
      data: { selected: [{ id: "gid://shopify/ProductVariant/1" }] },
      query: vi.fn(),
    };
  });

  afterEach(() => {
    delete globalThis.shopify;
  });

  it("loads the product's images and pre-checks the ones already saved on the variant", async () => {
    globalThis.shopify.query.mockResolvedValueOnce(
      queryResponse({
        mediaNodes: [image("gid://shopify/MediaImage/1"), image("gid://shopify/MediaImage/2")],
        gallery: ["gid://shopify/MediaImage/2"],
      }),
    );

    await mount();

    await waitFor(() => expect(checkboxes()).toHaveLength(2));
    expect(globalThis.shopify.query).toHaveBeenCalledWith(
      expect.stringContaining("VariantGallery"),
      { variables: { variantId: "gid://shopify/ProductVariant/1" } },
    );
    // The previously-saved image shows up in the ordered "mini gallery" list.
    expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("filters out non-image media (e.g. video) returned by the product", async () => {
    globalThis.shopify.query.mockResolvedValueOnce(
      queryResponse({
        mediaNodes: [
          image("gid://shopify/MediaImage/1"),
          { id: "gid://shopify/Video/1", mediaContentType: "VIDEO" },
        ],
      }),
    );

    await mount();

    await waitFor(() => expect(checkboxes()).toHaveLength(1));
  });

  it("shows an empty-state message when the product has no images", async () => {
    globalThis.shopify.query.mockResolvedValueOnce(queryResponse({ mediaNodes: [] }));

    await mount();

    await waitFor(() => {
      expect(
        screen.getByText("Este producto todavía no tiene imágenes."),
      ).toBeInTheDocument();
    });
  });

  it("treats a non-array metafield value (e.g. null, on a variant never configured before) as no selection", async () => {
    globalThis.shopify.query.mockResolvedValueOnce({
      data: {
        productVariant: {
          id: "gid://shopify/ProductVariant/1",
          product: { id: "gid://shopify/Product/1", media: { nodes: [image("gid://shopify/MediaImage/1")] } },
          galleryMetafield: null,
        },
      },
    });

    await mount();

    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    expect(screen.queryByText("Orden de la mini galería")).not.toBeInTheDocument();
  });

  it("shows an error banner when the initial load fails", async () => {
    globalThis.shopify.query.mockRejectedValueOnce(new Error("network error"));

    await mount();

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo cargar la galería de esta variante."),
      ).toBeInTheDocument();
    });
  });

  it("toggling a checkbox adds the image to the ordered mini-gallery list, unchecking removes it", async () => {
    globalThis.shopify.query.mockResolvedValueOnce(
      queryResponse({ mediaNodes: [image("gid://shopify/MediaImage/1")] }),
    );

    await mount();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    expect(screen.queryByText("Orden de la mini galería")).not.toBeInTheDocument();

    fireEvent.change(checkboxes()[0]);
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    fireEvent.change(checkboxes()[0]);
    await waitFor(() =>
      expect(screen.queryByText("Orden de la mini galería")).not.toBeInTheDocument(),
    );
  });

  it("moving an image up/down reorders the mini-gallery list and disables arrows at the boundaries", async () => {
    globalThis.shopify.query.mockResolvedValueOnce(
      queryResponse({
        mediaNodes: [
          image("gid://shopify/MediaImage/1", "https://cdn.shopify.com/1.jpg", "first"),
          image("gid://shopify/MediaImage/2", "https://cdn.shopify.com/2.jpg", "second"),
        ],
        gallery: ["gid://shopify/MediaImage/1", "gid://shopify/MediaImage/2"],
      }),
    );

    await mount();
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    const upButtons = buttonsLabelled("Subir");
    const downButtons = buttonsLabelled("Bajar");
    // First row's "up" and last row's "down" are disabled at the boundaries.
    expect(isDisabled(upButtons[0])).toBe(true);
    expect(isDisabled(downButtons[1])).toBe(true);
    expect(isDisabled(upButtons[1])).toBe(false);
    expect(isDisabled(downButtons[0])).toBe(false);

    fireEvent.click(downButtons[0]); // swap "first" and "second"

    await waitFor(() => {
      const thumbnails = document.querySelectorAll("s-thumbnail");
      expect(thumbnails[0].getAttribute("alt")).toBe("second");
      expect(thumbnails[1].getAttribute("alt")).toBe("first");
    });
  });

  it("saves the selected ids as a JSON-stringified array and shows a success banner", async () => {
    globalThis.shopify.query
      .mockResolvedValueOnce(
        queryResponse({
          mediaNodes: [image("gid://shopify/MediaImage/1")],
          gallery: ["gid://shopify/MediaImage/1"],
        }),
      )
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });

    await mount();
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => {
      expect(screen.getByText("Galería guardada.")).toBeInTheDocument();
    });
    expect(globalThis.shopify.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SaveVariantGallery"),
      {
        variables: {
          variantId: "gid://shopify/ProductVariant/1",
          value: JSON.stringify(["gid://shopify/MediaImage/1"]),
        },
      },
    );
  });

  it("shows the mutation's userErrors instead of a success banner when the save is rejected by Shopify", async () => {
    globalThis.shopify.query
      .mockResolvedValueOnce(
        queryResponse({ mediaNodes: [image("gid://shopify/MediaImage/1")] }),
      )
      .mockResolvedValueOnce({
        data: {
          metafieldsSet: {
            userErrors: [{ field: ["value"], message: "Tipo de metafield inválido." }],
          },
        },
      });

    await mount();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.change(checkboxes()[0]);
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => {
      expect(screen.getByText("Tipo de metafield inválido.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Galería guardada.")).not.toBeInTheDocument();
  });

  it("shows a generic error banner when the save request itself throws", async () => {
    globalThis.shopify.query
      .mockResolvedValueOnce(
        queryResponse({ mediaNodes: [image("gid://shopify/MediaImage/1")] }),
      )
      .mockRejectedValueOnce(new Error("network error"));

    await mount();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.change(checkboxes()[0]);
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Guardar"));

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo guardar la galería de esta variante."),
      ).toBeInTheDocument();
    });
  });

  it("clears a previous error banner once a save succeeds", async () => {
    globalThis.shopify.query
      .mockResolvedValueOnce(
        queryResponse({ mediaNodes: [image("gid://shopify/MediaImage/1")] }),
      )
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ data: { metafieldsSet: { userErrors: [] } } });

    await mount();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.change(checkboxes()[0]);
    await waitFor(() =>
      expect(screen.getByText("Orden de la mini galería")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() =>
      expect(
        screen.getByText("No se pudo guardar la galería de esta variante."),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => expect(screen.getByText("Galería guardada.")).toBeInTheDocument());
    expect(
      screen.queryByText("No se pudo guardar la galería de esta variante."),
    ).not.toBeInTheDocument();
  });
});
