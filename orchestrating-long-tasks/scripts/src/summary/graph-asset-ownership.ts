import type { FindingDetail, MediaAsset, NodeFinding } from "./types.ts";

/**
 * One owner per asset for the whole dataset. `node.assets` is the only place an asset object
 * lives, so the node that produced a file claims it and every later node that merely referenced
 * the same file gets nothing — which is what turned one screenshot into seventeen copies.
 */
export class AssetRegistry {
  private readonly idByUrl = new Map<string, string>();

  /** Returns the subset of `candidates` this caller owns, in candidate order. */
  claim(candidates: readonly MediaAsset[]): MediaAsset[] {
    const owned: MediaAsset[] = [];
    for (const asset of candidates) {
      if (!asset.url || this.idByUrl.has(asset.url)) continue;
      this.idByUrl.set(asset.url, asset.id);
      owned.push(asset);
    }
    return owned;
  }

  /** The id of the single asset carrying this url, wherever in the dataset it ended up. */
  idFor(url: string): string | undefined {
    return this.idByUrl.get(url);
  }
}

/**
 * Findings keep a reference to their evidence rather than a second copy of it. A screenshot that
 * no node claimed leaves no reference behind, because a dangling id would be a claim we cannot back.
 */
export function projectFindingsForNode(
  findings: readonly FindingDetail[],
  registry: AssetRegistry,
): NodeFinding[] {
  return findings.map((finding) => {
    const referenced = (finding.screenshots ?? [])
      .map((shot) => registry.idFor(shot.url))
      .filter((id): id is string => id !== undefined);
    // `screenshots: undefined` drops the key on serialization while keeping the shape explicit.
    return {
      ...finding,
      screenshots: undefined,
      ...(referenced.length > 0 ? { screenshotAssetIds: referenced } : {}),
    };
  });
}
