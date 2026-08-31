import { describe, expect, test } from "bun:test";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  extractFindingScreenshots,
  mapFindingDetails,
} from "../../../olt/scripts/src/summary/assets/index.ts";

describe("Round 3: Finding Screenshots & Evidence Extraction", () => {
  test("extracts finding screenshots from string arrays, object arrays, singular screenshot, and evidence references", () => {
    const task: TaskRecord = {
      id: "T-ui-screenshots",
      label: "Build Header Component",
      status: "changes_requested",
      requirement_ids: ["REQ-UI-HEADER"],
      write_scope: ["src/components/Header.tsx"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      validations: [
        {
          validator_id: "val-playwright",
          domain: "code-quality",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "F-STR-ARRAY",
          requirement_id: "REQ-UI-HEADER",
          severity: "critical",
          observation: "Header clips on mobile viewport",
          screenshots: [
            "evidence/screenshots/header-mobile-fail.png",
            "evidence/screenshots/header-mobile-crop.jpg",
          ],
          status: "open",
        },
        {
          id: "F-OBJ-ARRAY",
          requirement_id: "REQ-UI-HEADER",
          severity: "important",
          observation: "Contrast ratio failure in dark mode header",
          screenshots: [
            {
              id: "custom-contrast-shot",
              url: "evidence/screenshots/contrast-fail.png",
              title: "Contrast Audit Snapshot",
              dimensions: { width: 1920, height: 1080 },
              author: "a11y-auditor",
            },
          ],
          screenshot: "evidence/screenshots/contrast-fixed.webp",
          status: "open",
        },
        {
          id: "F-EVIDENCE-REFS",
          requirement_id: "REQ-UI-HEADER",
          severity: "minor",
          observation: "Sub-pixel margin rounding glitch",
          evidence: [
            {
              kind: "screenshot",
              url: "evidence/screenshots/nav-icon.svg",
              observation: "Nav icon margin clipping",
            },
            {
              kind: "image",
              reference: "evidence/screenshots/nav-hero.png",
              title: "Hero Navigation Reference",
            },
          ],
          status: "resolved",
        },
      ],
    };

    const findings = mapFindingDetails(task);
    expect(findings).toHaveLength(3);

    const fStr = findings.find((f) => f.id === "F-STR-ARRAY");
    expect(fStr).toBeDefined();
    expect(fStr?.screenshots).toHaveLength(2);
    const shot1 = fStr?.screenshots?.[0];
    expect(shot1?.id).toBe("F-STR-ARRAY-screenshot-1");
    expect(shot1?.type).toBe("image");
    expect(shot1?.url).toBe("evidence/screenshots/header-mobile-fail.png");
    expect(shot1?.mimeType).toBe("image/png");
    expect(shot1?.title).toBe("Finding Screenshot: header-mobile-fail.png");
    expect(shot1?.description).toBe("Screenshot evidence for finding F-STR-ARRAY");
    expect(shot1?.dimensions).toBeUndefined();
    expect(shot1?.author).toBe("val-playwright");
    expect(shot1?.metadata?.stage).toBe("validation");
    expect(shot1?.metadata?.findingId).toBe("F-STR-ARRAY");

    const shot2 = fStr?.screenshots?.[1];
    expect(shot2?.mimeType).toBe("image/jpeg");

    const fObj = findings.find((f) => f.id === "F-OBJ-ARRAY");
    expect(fObj).toBeDefined();
    expect(fObj?.screenshots).toHaveLength(2);
    const customShot = fObj?.screenshots?.[0];
    expect(customShot?.id).toBe("custom-contrast-shot");
    expect(customShot?.title).toBe("Contrast Audit Snapshot");
    expect(customShot?.dimensions).toEqual({ width: 1920, height: 1080 });
    expect(customShot?.author).toBe("a11y-auditor");

    const singularShot = fObj?.screenshots?.[1];
    expect(singularShot?.url).toBe("evidence/screenshots/contrast-fixed.webp");
    expect(singularShot?.mimeType).toBe("image/webp");
    expect(singularShot?.dimensions).toBeUndefined();

    const fEv = findings.find((f) => f.id === "F-EVIDENCE-REFS");
    expect(fEv).toBeDefined();
    expect(fEv?.screenshots).toHaveLength(2);
    const evShot1 = fEv?.screenshots?.[0];
    expect(evShot1?.url).toBe("evidence/screenshots/nav-icon.svg");
    expect(evShot1?.mimeType).toBe("image/svg+xml");
    expect(evShot1?.description).toBe("Nav icon margin clipping");

    const evShot2 = fEv?.screenshots?.[1];
    expect(evShot2?.url).toBe("evidence/screenshots/nav-hero.png");
    expect(evShot2?.title).toBe("Hero Navigation Reference");
  });

  test("extracts finding screenshots from plain strings inside f.evidence array", () => {
    const finding = {
      id: "F-STRING-EVIDENCE",
      requirement_id: "REQ-01",
      severity: "critical",
      observation: "Visual layout regression detected on mobile",
      evidence: ["screenshots/diff.webp", "reports/evidence-01.png"],
    };

    const extracted = extractFindingScreenshots(
      finding,
      "F-STRING-EVIDENCE",
      "validator-playwright",
    );
    expect(extracted).toHaveLength(2);

    const shot1 = extracted[0];
    expect(shot1.url).toBe("screenshots/diff.webp");
    expect(shot1.mimeType).toBe("image/webp");
    expect(shot1.type).toBe("image");
    expect(shot1.dimensions).toBeUndefined();
    expect(shot1.metadata?.stage).toBe("validation");
    expect(shot1.metadata?.findingId).toBe("F-STRING-EVIDENCE");
    expect(shot1.author).toBe("validator-playwright");

    const shot2 = extracted[1];
    expect(shot2.url).toBe("reports/evidence-01.png");
    expect(shot2.mimeType).toBe("image/png");
    expect(shot2.type).toBe("image");
    expect(shot2.dimensions).toBeUndefined();
    expect(shot2.metadata?.stage).toBe("validation");
    expect(shot2.metadata?.findingId).toBe("F-STRING-EVIDENCE");
  });

  test("extracts finding screenshots from mixed evidence arrays with objects, plain strings, and non-image paths", () => {
    const task: TaskRecord = {
      id: "T-mixed-evidence",
      label: "Mixed Evidence Task",
      status: "changes_requested",
      requirement_ids: ["REQ-MIX-01"],
      write_scope: ["src/app.tsx"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      findings: [
        {
          id: "F-MIXED-01",
          requirement_id: "REQ-MIX-01",
          severity: "critical",
          observation: "Several visual regressions found",
          evidence: [
            "evidence/diff-01.webp",
            {
              kind: "screenshot",
              url: "evidence/hero-shot.png",
              title: "Hero Banner Screenshot",
              observation: "Hero banner overlapping navbar",
            },
            "logs/execution.log",
            {
              kind: "command",
              reference: "cmd-val-check",
              observation: "Gate check failed",
            },
            "evidence/audit-icon.svg",
            {
              kind: "image",
              path: "evidence/footer.gif",
            },
          ],
        },
      ],
    };

    const findings = mapFindingDetails(task);
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.id).toBe("F-MIXED-01");
    expect(f.screenshots).toHaveLength(4);

    const urls = f.screenshots?.map((s) => s.url);
    expect(urls).toEqual([
      "evidence/diff-01.webp",
      "evidence/hero-shot.png",
      "evidence/audit-icon.svg",
      "evidence/footer.gif",
    ]);

    const webpShot = f.screenshots?.find((s) => s.url === "evidence/diff-01.webp");
    expect(webpShot?.mimeType).toBe("image/webp");
    expect(webpShot?.dimensions).toBeUndefined();
    expect(webpShot?.metadata?.stage).toBe("validation");
    expect(webpShot?.metadata?.findingId).toBe("F-MIXED-01");

    const heroShot = f.screenshots?.find((s) => s.url === "evidence/hero-shot.png");
    expect(heroShot?.title).toBe("Hero Banner Screenshot");
    expect(heroShot?.description).toBe("Hero banner overlapping navbar");
    expect(heroShot?.mimeType).toBe("image/png");

    const svgShot = f.screenshots?.find((s) => s.url === "evidence/audit-icon.svg");
    expect(svgShot?.mimeType).toBe("image/svg+xml");

    const gifShot = f.screenshots?.find((s) => s.url === "evidence/footer.gif");
    expect(gifShot?.mimeType).toBe("image/gif");
  });

  test("falls back from a screenshot object's url, to its path, to its reference", () => {
    const finding = {
      id: "F-URL-FALLBACK",
      screenshots: [{ path: "evidence/screenshots/from-path.png" }],
      screenshot: { reference: "evidence/screenshots/from-reference.png" },
    };

    const extracted = extractFindingScreenshots(finding, "F-URL-FALLBACK");
    expect(extracted.map((shot) => shot.url)).toEqual([
      "evidence/screenshots/from-path.png",
      "evidence/screenshots/from-reference.png",
    ]);
  });

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
      // Nothing opened the file, so its resolution is unknown rather than 1280x720.
      expect(asset.dimensions).toBeUndefined();
      expect(asset.metadata?.stage).toBe("validation");
      expect(asset.metadata?.findingId).toBe(`F-EXT-${ext.toUpperCase()}`);
      expect(asset.author).toBe("auditor");
    }
  });
});
