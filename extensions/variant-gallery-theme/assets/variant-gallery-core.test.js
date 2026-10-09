import { beforeEach, describe, expect, it } from "vitest";

// Plain browser IIFE script (no exports) that attaches itself to `window`.
// Importing it under the jsdom test environment runs that side effect, since
// `window`/`document` already exist as globals there.
import "./variant-gallery-core.js";

const { computeVisibleImages } = window.VariantGalleryCore;

const img = (id) => ({ id, src: `https://example.com/${id}.jpg` });

const allImages = [img(1), img(2), img(3), img(4)];

describe("computeVisibleImages", () => {
  describe("no gallery configured (0 images)", () => {
    it("returns all images unchanged when there is no legacy image either", () => {
      expect(computeVisibleImages(allImages, [], null)).toEqual(allImages);
    });

    it("returns all images unchanged when variantGalleryIds is undefined", () => {
      expect(computeVisibleImages(allImages, undefined, null)).toEqual(allImages);
    });

    it("moves the legacy image to the front, keeping the rest in place", () => {
      expect(computeVisibleImages(allImages, [], 3)).toEqual([
        img(3),
        img(1),
        img(2),
        img(4),
      ]);
    });

    it("falls back to the untouched list when the legacy id does not match any image", () => {
      expect(computeVisibleImages(allImages, [], 999)).toEqual(allImages);
    });

    it("does not duplicate the legacy image when it is already first", () => {
      expect(computeVisibleImages(allImages, [], 1)).toEqual(allImages);
    });
  });

  describe("exactly 1 gallery image configured", () => {
    it("moves the configured image to the front and ignores the legacy image", () => {
      expect(computeVisibleImages(allImages, [3], 2)).toEqual([
        img(3),
        img(1),
        img(2),
        img(4),
      ]);
    });

    it("falls back to the legacy image when the configured id is not a real image", () => {
      expect(computeVisibleImages(allImages, [999], 2)).toEqual([
        img(2),
        img(1),
        img(3),
        img(4),
      ]);
    });

    it("falls back to the plain image list when neither the configured id nor the legacy id resolve", () => {
      expect(computeVisibleImages(allImages, [999], 998)).toEqual(allImages);
    });
  });

  describe("2+ gallery images configured", () => {
    it("returns the gallery order, prefixed with the variant's legacy image", () => {
      expect(computeVisibleImages(allImages, [2, 4], 1)).toEqual([
        img(1),
        img(2),
        img(4),
      ]);
    });

    it("does not duplicate the legacy image when it is already part of the gallery", () => {
      expect(computeVisibleImages(allImages, [1, 2, 4], 1)).toEqual([
        img(1),
        img(2),
        img(4),
      ]);
    });

    it("returns just the gallery order when there is no legacy image", () => {
      expect(computeVisibleImages(allImages, [4, 2], null)).toEqual([
        img(4),
        img(2),
      ]);
    });

    it("silently drops gallery ids that no longer resolve to a real image (e.g. a deleted media)", () => {
      expect(computeVisibleImages(allImages, [999, 2, 4], null)).toEqual([
        img(2),
        img(4),
      ]);
    });

    it("treats a legacy id that fails to resolve the same as having no legacy image", () => {
      expect(computeVisibleImages(allImages, [2, 4], 999)).toEqual([
        img(2),
        img(4),
      ]);
    });

    it("does not fall back to the 1-image branch when only one gallery id resolves after filtering", () => {
      // Two configured, but one is stale -> only 1 left. This still must be
      // treated as "gallery configured with 1 real image" (i.e. the branch
      // above), not silently promoted into the >=2 branch's behavior.
      expect(computeVisibleImages(allImages, [999, 3], 1)).toEqual([
        img(3),
        img(1),
        img(2),
        img(4),
      ]);
    });
  });

  describe("id comparisons across string/number types", () => {
    // Liquid's `| json` filter always emits numbers as numbers and the media
    // id read off `variant.metafields[...].gallery` may come back as a
    // string from the metafield's jsonValue - findImage() has to bridge that
    // with String() coercion.
    it("matches a numeric image id against a string gallery id", () => {
      expect(computeVisibleImages(allImages, ["2", "4"], null)).toEqual([
        img(2),
        img(4),
      ]);
    });

    it("matches a numeric legacy id passed as a string", () => {
      expect(computeVisibleImages(allImages, [], "3")).toEqual([
        img(3),
        img(1),
        img(2),
        img(4),
      ]);
    });
  });

  describe("edge cases", () => {
    it("returns an empty array when the product has no images at all", () => {
      expect(computeVisibleImages([], [1, 2], 1)).toEqual([]);
    });

    it("does not mutate the input allImages array", () => {
      const copy = allImages.map((i) => ({ ...i }));
      computeVisibleImages(copy, [], 3);
      expect(copy).toEqual(allImages);
    });
  });
});

describe("computeGalleryItems", () => {
  const { computeGalleryItems } = window.VariantGalleryCore;
  const image = (id) => ({ type: "image", id, src: `https://example.com/${id}.jpg` });
  const video = (youtubeId) => ({ type: "video", youtubeId });
  const YT = "dQw4w9WgXcQ";
  const YT2 = "aqz-KE-bpKQ";

  it("returns just the images when there are no videos", () => {
    expect(computeGalleryItems(allImages, [2, 4], null, [])).toEqual([image(2), image(4)]);
    expect(computeGalleryItems(allImages, [2, 4], null, undefined)).toEqual([image(2), image(4)]);
  });

  it("puts a video at the configured position", () => {
    expect(computeGalleryItems(allImages, [2, 3, 4], null, [{ youtubeId: YT, position: 1 }])).toEqual([
      image(2),
      video(YT),
      image(3),
      image(4),
    ]);
  });

  it("supports the first position", () => {
    expect(computeGalleryItems(allImages, [2, 3], null, [{ youtubeId: YT, position: 0 }])).toEqual([
      video(YT),
      image(2),
      image(3),
    ]);
  });

  it("clamps a position past the end instead of dropping the video", () => {
    expect(computeGalleryItems(allImages, [2, 3], null, [{ youtubeId: YT, position: 99 }])).toEqual([
      image(2),
      image(3),
      video(YT),
    ]);
  });

  it("counts positions over the gallery, skipping the prepended native image", () => {
    // legacy 1 leads the gallery [2, 3]; position 1 = after gallery image 2.
    expect(computeGalleryItems(allImages, [2, 3], 1, [{ youtubeId: YT, position: 1 }])).toEqual([
      image(1),
      image(2),
      video(YT),
      image(3),
    ]);
  });

  it("keeps several videos in position order, and in configured order when they share one", () => {
    const result = computeGalleryItems(allImages, [2, 3, 4], null, [
      { youtubeId: YT2, position: 2 },
      { youtubeId: YT, position: 1 },
    ]);
    expect(result).toEqual([image(2), video(YT), image(3), video(YT2), image(4)]);

    const same = computeGalleryItems(allImages, [2, 3], null, [
      { youtubeId: YT, position: 1 },
      { youtubeId: YT2, position: 1 },
    ]);
    expect(same).toEqual([image(2), video(YT), video(YT2), image(3)]);
  });

  it("works when the variant has no gallery and shows every product image", () => {
    const result = computeGalleryItems(allImages, [], null, [{ youtubeId: YT, position: 2 }]);
    expect(result.map((i) => i.type)).toEqual(["image", "image", "video", "image", "image"]);
  });

  it("drops entries with an invalid id", () => {
    expect(
      computeGalleryItems(allImages, [2, 3], null, [
        { youtubeId: "short", position: 0 },
        { youtubeId: null, position: 0 },
      ]),
    ).toEqual([image(2), image(3)]);
  });
});
