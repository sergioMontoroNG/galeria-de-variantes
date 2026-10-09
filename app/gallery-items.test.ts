import { describe, expect, it } from "vitest";
import { buildItems, parseYoutubeId, readStoredVideos, splitItems } from "./gallery-items";

const YT = "dQw4w9WgXcQ";

describe("parseYoutubeId", () => {
  it.each([
    [YT, YT],
    [`https://www.youtube.com/watch?v=${YT}`, YT],
    [`https://www.youtube.com/watch?v=${YT}&t=10s`, YT],
    [`https://youtu.be/${YT}?si=abc`, YT],
    [`https://www.youtube.com/shorts/${YT}`, YT],
    [`https://www.youtube.com/embed/${YT}`, YT],
    [`youtube.com/watch?v=${YT}`, YT],
    [`  ${YT}  `, YT],
  ])("extracts the id from %s", (input, expected) => {
    expect(parseYoutubeId(input)).toBe(expected);
  });

  it.each(["", "hola", "https://vimeo.com/123456789", "https://www.youtube.com/watch?v=corto"])(
    "rejects %s",
    (input) => {
      expect(parseYoutubeId(input)).toBeNull();
    },
  );
});

describe("readStoredVideos", () => {
  it("ignores malformed values and duplicates", () => {
    expect(readStoredVideos(null)).toEqual([]);
    expect(
      readStoredVideos([{ youtubeId: YT, position: 2 }, { youtubeId: YT, position: 0 }, { youtubeId: "x" }, null]),
    ).toEqual([{ youtubeId: YT, position: 2 }]);
  });
});

describe("buildItems / splitItems", () => {
  it("round-trips images and videos", () => {
    const videos = [{ youtubeId: YT, position: 1 }];
    const items = buildItems(["a", "b", "c"], videos);
    expect(items.map((i) => i.kind)).toEqual(["image", "video", "image", "image"]);
    expect(splitItems(items)).toEqual({ imageIds: ["a", "b", "c"], videos });
  });

  it("keeps a video that was past the end at the end", () => {
    const items = buildItems(["a"], [{ youtubeId: YT, position: 9 }]);
    expect(items.map((i) => i.kind)).toEqual(["image", "video"]);
    expect(splitItems(items).videos).toEqual([{ youtubeId: YT, position: 1 }]);
  });

  it("keeps videos when there are no images", () => {
    expect(splitItems(buildItems([], [{ youtubeId: YT, position: 0 }])).videos).toEqual([
      { youtubeId: YT, position: 0 },
    ]);
  });
});
