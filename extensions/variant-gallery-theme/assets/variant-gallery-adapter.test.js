import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both scripts are plain IIFEs with side effects (they read the DOM and
// attach listeners as soon as they're evaluated), so each test needs a full
// fresh module + DOM to reason about independently.
async function loadAdapter() {
  vi.resetModules();
  await import("./variant-gallery-core.js");
  await import("./variant-gallery-adapter.js");
}

// Must be called only after all mutations to `payload` are done: it
// serializes to JSON immediately, so anything mutated afterwards is invisible
// to the adapter.
function setPayload(payload) {
  const script = document.createElement("script");
  script.type = "application/json";
  script.setAttribute("data-variant-gallery-data", "");
  script.textContent = JSON.stringify(payload);
  document.body.appendChild(script);
}

function setVariantInput(variantId) {
  const input = document.createElement("input");
  input.name = "id";
  input.value = String(variantId);
  document.body.appendChild(input);
}

// Slides live inside their own gallery wrapper, as in the real theme markup
// (#MediaGallery-<section-id>) - kept separate from the payload <script> and
// the variant <input> so reorder assertions aren't polluted by those.
function slidesContainer() {
  let container = document.getElementById("MediaGallery-test");
  if (!container) {
    container = document.createElement("div");
    container.id = "MediaGallery-test";
    document.body.appendChild(container);
  }
  return container;
}

function addSlide(mediaId, sectionPrefix = "template--123__main") {
  const slide = document.createElement("div");
  slide.setAttribute("data-media-id", `${sectionPrefix}-${mediaId}`);
  slidesContainer().appendChild(slide);
  return slide;
}

// A factory (not a shared constant) so each test can freely mutate its own
// copy - e.g. to add extra variants - without leaking state into others.
function basePayload() {
  return {
    images: [
      { id: 1, src: "https://example.com/1.jpg" },
      { id: 2, src: "https://example.com/2.jpg" },
      { id: 3, src: "https://example.com/3.jpg" },
    ],
    variants: {
      100: { gallery: [2, 3], legacyImageId: 1 },
      200: { gallery: [], legacyImageId: 2 },
      300: { gallery: [], legacyImageId: null },
    },
  };
}

describe("variant-gallery-adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // jsdom's default readyState is "complete", so the adapter's ready()
    // helper runs its callback synchronously as soon as the module loads.
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does nothing when there is no [data-variant-gallery-data] payload on the page", async () => {
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    setVariantInput(100);

    await loadAdapter();

    // Neither slide should have been touched.
    expect(s1.hidden).toBe(false);
    expect(s2.hidden).toBe(false);
  });

  it("hides slides not in the computed visible set and shows the rest, on initial load", async () => {
    setPayload(basePayload());
    setVariantInput(100); // gallery: [2, 3], legacy: 1 -> visible: [1, 2, 3]
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);

    await loadAdapter();

    expect(s1.hidden).toBe(false);
    expect(s2.hidden).toBe(false);
    expect(s3.hidden).toBe(false);
  });

  it("shows every image when the variant has 0 gallery images configured", async () => {
    setPayload(basePayload());
    setVariantInput(200); // gallery: [], legacy: 2 -> 0/1-image branch shows everything
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);

    await loadAdapter();

    expect(s1.hidden).toBe(false);
    expect(s2.hidden).toBe(false);
    expect(s3.hidden).toBe(false);
  });

  it("hides a slide whose image is excluded by a >=2-image gallery", async () => {
    const payload = basePayload();
    payload.variants[500] = { gallery: [2, 3], legacyImageId: null }; // excludes image 1
    setPayload(payload);
    setVariantInput(500);
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);

    await loadAdapter();

    expect(s1.hidden).toBe(true);
    expect(s2.hidden).toBe(false);
    expect(s3.hidden).toBe(false);
  });

  it("reorders slides in the DOM to match the computed order and marks the first as active", async () => {
    setPayload(basePayload());
    setVariantInput(100); // gallery: [2, 3], legacy: 1 -> visible order: [1, 2, 3]
    const s3 = addSlide(3);
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const parent = s3.parentElement;

    await loadAdapter();

    expect(Array.from(parent.children)).toEqual([s1, s2, s3]);
    expect(s1.classList.contains("is-active")).toBe(true);
    expect(s2.classList.contains("is-active")).toBe(false);
    expect(s3.classList.contains("is-active")).toBe(false);
  });

  it("clears a stale is-active class from a slide that becomes hidden", async () => {
    const payload = basePayload();
    // Only the >=2-gallery-images branch ever hides a slide (0/1-image
    // branches always show every product image), so use that here.
    payload.variants[500] = { gallery: [2, 3], legacyImageId: null }; // visible: [2, 3], image 1 hidden.
    setPayload(payload);
    setVariantInput(500);
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);
    s1.classList.add("is-active");

    await loadAdapter();

    expect(s1.hidden).toBe(true);
    expect(s1.classList.contains("is-active")).toBe(false);
    expect(s2.classList.contains("is-active")).toBe(true);
  });

  it("does nothing on load when the variant id input has no value and no variant-change event has fired", async () => {
    setPayload(basePayload());
    const input = document.createElement("input");
    input.name = "id";
    input.value = "";
    document.body.appendChild(input);
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);

    await loadAdapter();

    expect(s1.hidden).toBe(false);
    expect(s2.hidden).toBe(false);
    expect(s3.hidden).toBe(false);
  });

  it("re-renders on a product:variant-change event using the new variant's gallery", async () => {
    const payload = basePayload();
    payload.variants[600] = { gallery: [1, 2], legacyImageId: null }; // excludes image 3
    setPayload(payload);
    setVariantInput(100); // initial: visible [1, 2, 3], nothing hidden
    const s1 = addSlide(1);
    const s2 = addSlide(2);
    const s3 = addSlide(3);

    await loadAdapter();
    expect(s3.hidden).toBe(false);

    document.dispatchEvent(
      new CustomEvent("product:variant-change", {
        detail: { variant: { id: 200 } }, // gallery: [], legacy: 2 -> still shows all
      }),
    );
    expect(s1.hidden).toBe(false);

    document.dispatchEvent(
      new CustomEvent("product:variant-change", {
        detail: { variant: { id: 600 } },
      }),
    );

    expect(s3.hidden).toBe(true);
    expect(s1.hidden).toBe(false);
    expect(s2.hidden).toBe(false);
  });

  it("ignores a product:variant-change event with no variant in its detail", async () => {
    const payload = basePayload();
    payload.variants[500] = { gallery: [2, 3], legacyImageId: null }; // excludes image 1
    setPayload(payload);
    setVariantInput(500);
    const s1 = addSlide(1);
    addSlide(2);
    addSlide(3);

    await loadAdapter();
    expect(s1.hidden).toBe(true); // sanity: variant 500 excludes image 1

    document.dispatchEvent(
      new CustomEvent("product:variant-change", { detail: {} }),
    );

    // State from the previous render must be untouched.
    expect(s1.hidden).toBe(true);
  });

  it("looks up the variant by numeric event id even though payload.variants keys are strings", async () => {
    const payload = basePayload();
    payload.variants[700] = { gallery: [2, 3], legacyImageId: null }; // excludes image 1
    setPayload(payload);
    setVariantInput(700);
    const s1 = addSlide(1);
    addSlide(2);
    addSlide(3);

    await loadAdapter();
    expect(s1.hidden).toBe(true); // sanity

    document.dispatchEvent(
      new CustomEvent("product:variant-change", {
        detail: { variant: { id: 100 } }, // numeric id, event payload mirrors Shopify's real shape
      }),
    );

    // variant 100's gallery ([2,3]) + legacy (1) shows image 1 again, proving
    // `payload.variants[String(variantId)]` correctly bridged number -> key.
    expect(s1.hidden).toBe(false);
  });

  it("extracts the media id from a data-media-id attribute prefixed with the section id", async () => {
    const payload = basePayload();
    payload.variants[500] = { gallery: [2, 3], legacyImageId: null }; // excludes image 1
    setPayload(payload);
    setVariantInput(500);
    const slide = addSlide(1, "template--999__main-product");

    await loadAdapter();

    expect(slide.hidden).toBe(true);
  });
});
