import { getMimeTypeForUrl, isImageExtension } from "./asset-mapper-props.ts";
import type { MediaAsset } from "./types.ts";

export function extractFindingScreenshots(
  f: Record<string, unknown>,
  findingId: string,
  author?: string,
  timestamp?: string,
): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const seenUrls = new Set<string>();

  const processCandidate = (candidate: unknown, fallbackIndex: number) => {
    if (!candidate) return;
    let url: string | undefined = undefined;
    let rawObj: Record<string, unknown> | undefined = undefined;

    if (typeof candidate === "string" && candidate.trim().length > 0) {
      url = candidate.trim();
    } else if (typeof candidate === "object" && candidate !== null) {
      rawObj = candidate as Record<string, unknown>;
      if (typeof rawObj.url === "string" && rawObj.url.trim().length > 0) {
        url = rawObj.url.trim();
      } else if (typeof rawObj.path === "string" && rawObj.path.trim().length > 0) {
        url = rawObj.path.trim();
      } else if (typeof rawObj.reference === "string" && rawObj.reference.trim().length > 0) {
        url = rawObj.reference.trim();
      }
    }

    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);

    const filename = url.split("/").pop() || url;
    const mimeType = getMimeTypeForUrl(url, rawObj?.mimeType);
    const assetId =
      typeof rawObj?.id === "string" && rawObj.id.trim().length > 0
        ? rawObj.id.trim()
        : `${findingId}-screenshot-${fallbackIndex}`;
    const title =
      typeof rawObj?.title === "string" && rawObj.title.trim().length > 0
        ? rawObj.title.trim()
        : `Finding Screenshot: ${filename}`;
    const description =
      typeof rawObj?.description === "string" && rawObj.description.trim().length > 0
        ? rawObj.description.trim()
        : `Screenshot evidence for finding ${findingId}`;
    const assetAuthor =
      typeof rawObj?.author === "string" && rawObj.author.trim().length > 0
        ? rawObj.author.trim()
        : author;
    const assetTimestamp =
      typeof rawObj?.timestamp === "string" && rawObj.timestamp.trim().length > 0
        ? rawObj.timestamp.trim()
        : timestamp;
    const dimensions =
      rawObj?.dimensions &&
      typeof rawObj.dimensions === "object" &&
      typeof (rawObj.dimensions as { width?: unknown }).width === "number" &&
      typeof (rawObj.dimensions as { height?: unknown }).height === "number"
        ? (rawObj.dimensions as { width: number; height: number })
        : undefined;
    const sizeBytes =
      typeof rawObj?.sizeBytes === "number"
        ? rawObj.sizeBytes
        : typeof rawObj?.size_bytes === "number"
          ? rawObj.size_bytes
          : undefined;

    const existingMeta =
      rawObj?.metadata && typeof rawObj.metadata === "object"
        ? (rawObj.metadata as Record<string, unknown>)
        : {};

    assets.push({
      id: assetId,
      type: "image",
      url,
      title,
      description,
      mimeType,
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
      ...(dimensions === undefined ? {} : { dimensions }),
      ...(assetAuthor === undefined ? {} : { author: assetAuthor }),
      ...(assetTimestamp === undefined ? {} : { timestamp: assetTimestamp }),
      metadata: {
        stage: "validation",
        findingId,
        ...existingMeta,
      },
    });
  };

  if (Array.isArray(f.screenshots)) {
    for (let i = 0; i < f.screenshots.length; i++) {
      processCandidate(f.screenshots[i], i + 1);
    }
  }

  if (f.screenshot) {
    processCandidate(f.screenshot, assets.length + 1);
  }

  if (Array.isArray(f.evidence)) {
    for (let i = 0; i < f.evidence.length; i++) {
      const item = f.evidence[i];
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed.length > 0 && isImageExtension(trimmed)) {
          processCandidate(trimmed, assets.length + 1);
        }
      } else if (typeof item === "object" && item !== null) {
        const ev = item as Record<string, unknown>;
        const kind = typeof ev.kind === "string" ? ev.kind.toLowerCase() : "";
        const ref = typeof ev.reference === "string" ? ev.reference.trim() : "";
        const evUrl = typeof ev.url === "string" ? ev.url.trim() : "";
        const path = typeof ev.path === "string" ? ev.path.trim() : "";
        const target = evUrl || ref || path;
        if (
          kind === "screenshot" ||
          kind === "image" ||
          (target.length > 0 && isImageExtension(target))
        ) {
          processCandidate(
            {
              url: target,
              ...(typeof ev.observation === "string" ? { description: ev.observation } : {}),
              ...(typeof ev.title === "string" ? { title: ev.title } : {}),
            },
            assets.length + 1,
          );
        }
      }
    }
  }

  return assets;
}
