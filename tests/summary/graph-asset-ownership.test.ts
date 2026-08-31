import { describe, expect, test } from "bun:test";
import {
  AssetRegistry,
  projectFindingsForNode,
} from "../../../olt/scripts/src/summary/graph/index.ts";
import type { FindingDetail, MediaAsset } from "../../../olt/scripts/src/summary/graph/index.ts";

function asset(id: string, url: string): MediaAsset {
  return { id, type: "image", url };
}

function finding(id: string, screenshots?: MediaAsset[]): FindingDetail {
  return {
    id,
    severity: "important",
    observation: `finding ${id}`,
    status: "open",
    screenshots,
  };
}

describe("AssetRegistry.claim", () => {
  test("registers a new url and reports it as newly owned", () => {
    const registry = new AssetRegistry();
    const owned = registry.claim([asset("a1", "https://x/1.png")]);
    expect(owned).toEqual([asset("a1", "https://x/1.png")]);
    expect(registry.idFor("https://x/1.png")).toBe("a1");
  });

  test("skips a later candidate whose url an earlier claim already owns", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("a1", "https://x/1.png")]);
    const owned = registry.claim([asset("a2", "https://x/1.png")]);
    expect(owned).toEqual([]);
    expect(registry.idFor("https://x/1.png")).toBe("a1");
  });

  test("skips candidates with an empty url without registering them", () => {
    const registry = new AssetRegistry();
    const owned = registry.claim([asset("a1", "")]);
    expect(owned).toEqual([]);
    expect(registry.idFor("")).toBeUndefined();
  });
});

describe("AssetRegistry.idFor", () => {
  test("returns undefined for a url nothing has claimed", () => {
    const registry = new AssetRegistry();
    expect(registry.idFor("https://unclaimed")).toBeUndefined();
  });
});

describe("projectFindingsForNode", () => {
  test("drops the screenshots array and adds no screenshotAssetIds when a finding has none", () => {
    const registry = new AssetRegistry();
    const [result] = projectFindingsForNode([finding("F-1")], registry);
    expect(result?.screenshots).toBeUndefined();
    expect(result?.screenshotAssetIds).toBeUndefined();
  });

  test("maps a finding's screenshot urls to the ids the registry already owns", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("shot-1", "https://x/a.png")]);
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-1", "https://x/a.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toEqual(["shot-1"]);
    expect(result?.screenshots).toBeUndefined();
  });

  test("drops a screenshot the registry never claimed instead of surfacing an undefined id", () => {
    const registry = new AssetRegistry();
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-x", "https://x/unclaimed.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toBeUndefined();
  });

  test("keeps only the claimed ids when a finding mixes claimed and unclaimed screenshots", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("shot-1", "https://x/a.png")]);
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-1", "https://x/a.png"), asset("shot-2", "https://x/b.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toEqual(["shot-1"]);
  });
});
