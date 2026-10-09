// Lógica pura de la galería editable: fotos y vídeos de YouTube en un solo orden.
//
// En Shopify se guardan por separado para que n8n (que solo conoce fotos) no
// pueda borrar los vídeos: `gallery` lleva solo los ids de las fotos y
// `gallery_videos` lleva [{ youtubeId, position }], donde `position` es el
// número de fotos que van antes del vídeo (0 = el primero).

export type GalleryItem =
  | { kind: "image"; id: string }
  | { kind: "video"; youtubeId: string };

export type StoredVideo = { youtubeId: string; position: number };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

// Acepta el id suelto o cualquier enlace habitual de YouTube.
export function parseYoutubeId(input: string): string | null {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/);
    candidate = match ? match[1] : url.searchParams.get("v");
  }
  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
}

// Lee el metafield `gallery_videos` descartando lo que no tenga forma válida.
export function readStoredVideos(raw: unknown): StoredVideo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const videos: StoredVideo[] = [];
  for (const entry of raw) {
    const youtubeId = entry?.youtubeId;
    const position = Number(entry?.position);
    if (typeof youtubeId !== "string" || !YOUTUBE_ID.test(youtubeId) || seen.has(youtubeId)) continue;
    seen.add(youtubeId);
    videos.push({ youtubeId, position: Number.isFinite(position) && position > 0 ? Math.floor(position) : 0 });
  }
  return videos;
}

// Fotos + vídeos guardados -> lista única en el orden de la galería.
export function buildItems(imageIds: string[], videos: StoredVideo[]): GalleryItem[] {
  const items: GalleryItem[] = imageIds.map((id) => ({ kind: "image", id }));
  const sorted = videos
    .map((video, order) => ({ ...video, order }))
    .sort((a, b) => a.position - b.position || a.order - b.order);
  for (const video of sorted) {
    let index = 0;
    let seen = 0;
    while (index < items.length && (seen < video.position || items[index].kind === "video")) {
      if (items[index].kind === "image") seen++;
      index++;
    }
    items.splice(index, 0, { kind: "video", youtubeId: video.youtubeId });
  }
  return items;
}

// Lista única -> lo que se guarda en Shopify.
export function splitItems(items: GalleryItem[]): { imageIds: string[]; videos: StoredVideo[] } {
  const imageIds: string[] = [];
  const videos: StoredVideo[] = [];
  for (const item of items) {
    if (item.kind === "image") imageIds.push(item.id);
    else videos.push({ youtubeId: item.youtubeId, position: imageIds.length });
  }
  return { imageIds, videos };
}

export function itemKey(item: GalleryItem) {
  return item.kind === "image" ? item.id : `yt:${item.youtubeId}`;
}
