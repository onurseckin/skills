import type { FindingDetail, MediaAsset, NodeFinding } from "../types.ts";

export class AssetRegistry {
  private readonly idByUrl: Map<string, string>;

  constructor() {
    this.idByUrl = new Map<string, string>();
  }

  claim(candidates: readonly MediaAsset[]): MediaAsset[] {
    const owned: MediaAsset[] = [];
    for (const asset of candidates) {
      if (!asset.url || this.idByUrl.has(asset.url)) continue;
      this.idByUrl.set(asset.url, asset.id);
      owned.push(asset);
    }
    return owned;
  }

  idFor(url: string): string | undefined {
    return this.idByUrl.get(url);
  }
}

export function projectFindingsForNode(
  findings: readonly FindingDetail[],
  registry: AssetRegistry,
): NodeFinding[] {
  return findings.map((finding) => {
    const referenced = (finding.screenshots ?? [])
      .map((shot) => registry.idFor(shot.url))
      .filter((id): id is string => id !== undefined);
    return {
      ...finding,
      screenshots: undefined,
      ...(referenced.length > 0 ? { screenshotAssetIds: referenced } : {}),
    };
  });
}
