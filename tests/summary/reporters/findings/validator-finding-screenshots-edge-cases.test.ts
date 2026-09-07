import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { extractFindingScreenshots } from "../../../../olt/scripts/src/summary/assets/index.ts";
import { cleanupVirtualSummaryFS, setupVirtualSummaryFS } from "../../fixture.ts";

beforeEach(() => {
  setupVirtualSummaryFS();
});

afterEach(() => {
  cleanupVirtualSummaryFS();
});

describe("Round 3: Finding Screenshots & Evidence Extraction", () => {
  test("normalizes MIME types for every supported image extension and measures no dimensions", () => {
    const extensions = [
      { ext: "png", expectedMime: "image/png" },
      { ext: "jpg", expectedMime: "image/jpeg" },
      { ext: "jpeg", expectedMime: "image/jpeg" },
      { ext: "webp", expectedMime: "image/webp" },
      { ext: "gif", expectedMime: "image/gif" },
      { ext: "svg", expectedMime: "image/svg+xml" },
      { ext: "bmp", expectedMime: "image/bmp" },
    ];

    for (const { ext, expectedMime } of extensions) {
      const finding = {
        id: `F-EXT-${ext.toUpperCase()}`,
        evidence: [`artifacts/render.${ext}`],
      };

      const extracted = extractFindingScreenshots(finding, finding.id, "auditor");
      expect(extracted).toHaveLength(1);
      const asset = extracted[0];
      expect(asset.url).toBe(`artifacts/render.${ext}`);
      expect(asset.mimeType).toBe(expectedMime);
      expect(asset.type).toBe("image");
      expect(asset.dimensions).toBeUndefined();
      expect(asset.metadata?.stage).toBe("validation");
      expect(asset.metadata?.findingId).toBe(`F-EXT-${ext.toUpperCase()}`);
      expect(asset.author).toBe("auditor");
    }
  });

  test("edge cases: URL deduplication across candidate fields", () => {
    const finding = {
      id: "F-DEDUP",
      screenshots: [
        "evidence/shot-1.png",
        "evidence/shot-1.png",
        { url: "evidence/shot-1.png" },
        "evidence/shot-2.png",
      ],
      screenshot: "evidence/shot-2.png",
      evidence: ["evidence/shot-1.png", { url: "evidence/shot-2.png" }, "evidence/shot-3.png"],
    };

    const extracted = extractFindingScreenshots(finding, "F-DEDUP");
    expect(extracted).toHaveLength(3);
    expect(extracted.map((s) => s.url)).toEqual([
      "evidence/shot-1.png",
      "evidence/shot-2.png",
      "evidence/shot-3.png",
    ]);
  });

  test("edge cases: query strings, hash fragments, and URL normalization", () => {
    const finding = {
      id: "F-QUERY-HASH",
      evidence: [
        "evidence/snapshot.png?v=2#details",
        "evidence/diff.webp?token=abc",
        "evidence/graph.svg#section-1",
      ],
    };

    const extracted = extractFindingScreenshots(finding, "F-QUERY-HASH");
    expect(extracted).toHaveLength(3);
    expect(extracted[0].mimeType).toBe("image/png");
    expect(extracted[1].mimeType).toBe("image/webp");
    expect(extracted[2].mimeType).toBe("image/svg+xml");
  });

  test("edge cases: filtering non-image candidates and empty evidence", () => {
    const finding = {
      id: "F-FILTER-NON-IMAGE",
      evidence: [
        "audit/run.log",
        "config/settings.json",
        "bundle.zip",
        "document.pdf",
        { kind: "command", reference: "cmd-1", observation: "Gate check failed" },
        { kind: "metrics", reference: "cpu-usage" },
        "",
        "   ",
      ],
    };

    const extracted = extractFindingScreenshots(finding, "F-FILTER-NON-IMAGE");
    expect(extracted).toHaveLength(0);

    const emptyFinding = { id: "F-EMPTY" };
    expect(extractFindingScreenshots(emptyFinding, "F-EMPTY")).toHaveLength(0);
  });

  test("edge cases: explicit MIME override, dimensions, and custom props retention", () => {
    const finding = {
      id: "F-CUSTOM-PROPS",
      screenshots: [
        {
          id: "custom-shot-id",
          url: "evidence/custom.png",
          mimeType: "image/custom+png",
          dimensions: { width: 800, height: 600 },
          title: "Custom Title",
          description: "Custom Description",
          author: "custom-auditor",
          timestamp: "2026-08-19T00:00:00.000Z",
        },
      ],
    };

    const extracted = extractFindingScreenshots(finding, "F-CUSTOM-PROPS");
    expect(extracted).toHaveLength(1);
    const asset = extracted[0];
    expect(asset.id).toBe("custom-shot-id");
    expect(asset.mimeType).toBe("image/custom+png");
    expect(asset.dimensions).toEqual({ width: 800, height: 600 });
    expect(asset.title).toBe("Custom Title");
    expect(asset.description).toBe("Custom Description");
    expect(asset.author).toBe("custom-auditor");
    expect(asset.timestamp).toBe("2026-08-19T00:00:00.000Z");
  });
});
