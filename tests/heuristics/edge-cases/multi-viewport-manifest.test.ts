/**
 * @file multi-viewport-manifest.test.ts
 * Modular unit tests for Multi-Viewport Manifest & 4 Pillars Hierarchy Heuristics
 */

import { describe, expect, it } from "bun:test";
import {
  auditSingleViewportManifest,
  CANONICAL_VIEWPORTS,
  CANONICAL_VIEWPORT_SPECS,
  computePhysicalViewportMetrics,
  normalizePillar,
  synthesizeDprAwareCompanionManifest,
  verifyMultiViewportManifests,
  type MultiViewportBundleInput,
  type ScreenshotArtifact,
} from "../../../olt/scripts/src/heuristics/multi-viewport-manifest/index.ts";
import type {
  CompanionManifestV2,
  EvaluatedCriterion,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Extended Heuristics: Multi-Viewport Manifest & 4 Pillars Hierarchy", () => {
  const mkCrit = (id: string, pillar: string, passed: boolean): EvaluatedCriterion => ({
    id,
    pillar: pillar as EvaluatedCriterion["pillar"],
    name: `Crit ${id}`,
    passed,
    details: "Valid details token scale",
    evidence: "Evaluated 12 elements with 0 violations",
  });

  const mkManifest = (viewport: string, passed = true): CompanionManifestV2 => ({
    version: "2.0",
    screenId: "dashboard",
    viewport,
    timestamp: new Date().toISOString(),
    verdict: passed ? "CERTIFIED" : "DEFECTS_FOUND",
    totalDefects: passed ? 0 : 1,
    criticalCount: 0,
    seriousCount: passed ? 0 : 1,
    moderateCount: 0,
    minorCount: 0,
    criteria: [
      mkCrit("CRIT-MECH", "mechanical", passed),
      mkCrit("CRIT-COGN", "cognitive", passed),
      mkCrit("CRIT-PROD", "product", passed),
      mkCrit("CRIT-UX", "ux", passed),
    ],
    pillars: {
      mechanical: { pillar: "mechanical", passed, defects: [], evaluatedCount: 1 },
      cognitive: { pillar: "cognitive", passed, defects: [], evaluatedCount: 1 },
      product: { pillar: "product", passed, defects: [], evaluatedCount: 1 },
      ux: { pillar: "ux", passed, defects: [], evaluatedCount: 1 },
      custom: { pillar: "custom", passed, defects: [], evaluatedCount: 1 },
    },
    allDefects: [],
    remediationSummary: [],
  });

  const validShot = (vp: string): ScreenshotArtifact => ({
    viewport: vp,
    path: `/screenshots/${vp}.png`,
    sizeBytes: 15420,
  });

  it("certifies complete 4-viewport bundle and flags missing viewports", () => {
    const fullInput: MultiViewportBundleInput = {
      entries: CANONICAL_VIEWPORTS.map((vp) => ({
        viewport: vp,
        manifest: mkManifest(vp, true),
        screenshot: validShot(vp),
      })),
    };
    const res = verifyMultiViewportManifests(fullInput);
    expect(res.passed).toBe(true);
    expect(res.verifiedViewports.length).toBe(4);
    expect(res.missingViewports.length).toBe(0);

    const partialInput: MultiViewportBundleInput = {
      entries: fullInput.entries.slice(0, 3),
    };
    const partialRes = verifyMultiViewportManifests(partialInput);
    expect(partialRes.passed).toBe(false);
    expect(partialRes.missingViewports).toContain("desktop-wide");
    expect(partialRes.defects.some((d) => d.category === "missing_manifest")).toBe(true);
  });

  it("flags undersized dummy screenshots (< 1024 bytes) and missing pillars", () => {
    const smallShot = auditSingleViewportManifest("mobile", mkManifest("mobile"), {
      viewport: "mobile",
      sizeBytes: 67,
    });
    expect(smallShot.passed).toBe(false);
    expect(smallShot.defects.some((d) => d.category === "undersized_screenshot")).toBe(true);

    const brokenManifest: CompanionManifestV2 = {
      ...mkManifest("mobile"),
      criteria: [mkCrit("CRIT-MECH", "mechanical", true), mkCrit("CRIT-COGN", "cognitive", true)],
      pillars: {
        mechanical: { pillar: "mechanical", passed: true, defects: [], evaluatedCount: 1 },
        cognitive: { pillar: "cognitive", passed: true, defects: [], evaluatedCount: 1 },
        custom: { pillar: "custom", passed: true, defects: [], evaluatedCount: 1 },
      },
    };
    const audit = auditSingleViewportManifest("mobile", brokenManifest, validShot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.missingPillars).toContain("product");
    expect(audit.missingPillars).toContain("ux");
  });

  it("flags criteria with non-boolean pass states, empty details, or failed states", () => {
    const rawManifest = {
      version: "2.0",
      viewport: "mobile",
      criteria: [
        { id: "C1", pillar: "mechanical", passed: "yes", details: "text", evidence: "24px" },
        { id: "C2", pillar: "cognitive", passed: true, details: " ", evidence: "" },
        { id: "C3", pillar: "product", passed: false, details: "Mismatch", evidence: "bad" },
      ],
    };
    const audit = auditSingleViewportManifest("mobile", rawManifest, validShot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.defects.some((d) => d.category === "missing_boolean_passed")).toBe(true);
    expect(audit.defects.some((d) => d.category === "empty_details_evidence")).toBe(true);
    expect(audit.defects.some((d) => d.category === "criterion_failed")).toBe(true);
  });

  it("normalizes pillar strings and computes physical viewport metrics", () => {
    expect(normalizePillar("mechanical")).toBe("mechanical");
    expect(normalizePillar("Cognitive")).toBe("cognitive");
    expect(normalizePillar("Product")).toBe("product");
    expect(normalizePillar("UX")).toBe("ux");
    expect(normalizePillar("ux ergonomics")).toBe("ux");
    expect(normalizePillar("unknown")).toBeNull();

    const wide1x = computePhysicalViewportMetrics("desktop-wide", 1.0);
    expect(wide1x.physicalWidth).toBe(1920);
    expect(wide1x.isRetinaOrHiDpi).toBe(false);

    const wide2x = computePhysicalViewportMetrics("desktop-wide", 2.0);
    expect(wide2x.physicalWidth).toBe(3840);
    expect(wide2x.isRetinaOrHiDpi).toBe(true);

    const desk2x = computePhysicalViewportMetrics("desktop", 2.0);
    expect(desk2x.physicalWidth).toBe(2880);

    const tablet2x = computePhysicalViewportMetrics("tablet");
    expect(tablet2x.physicalWidth).toBe(1536);

    const mobile3x = computePhysicalViewportMetrics("mobile");
    expect(mobile3x.physicalWidth).toBe(1170);
  });

  it("synthesizes DPR-aware manifests and verifies bundles with DPR overrides", () => {
    for (const vp of CANONICAL_VIEWPORTS) {
      const manifest = synthesizeDprAwareCompanionManifest(vp);
      expect(manifest.verdict).toBe("CERTIFIED");
      expect(manifest.viewport).toBe(vp);
      const audit = auditSingleViewportManifest(vp, manifest, { viewport: vp, sizeBytes: 4096 });
      expect(audit.passed).toBe(true);
      expect(audit.dpr).toBe(CANONICAL_VIEWPORT_SPECS[vp].defaultDpr);
    }

    const dprEntries = CANONICAL_VIEWPORTS.map((vp) => ({
      viewport: vp,
      manifest: synthesizeDprAwareCompanionManifest(vp, { dpr: 2.0 }),
      screenshot: { viewport: vp, sizeBytes: 15000, dpr: 2.0 },
      devicePixelRatio: 2.0,
    }));
    const result = verifyMultiViewportManifests({ entries: dprEntries });
    expect(result.passed).toBe(true);
    expect(result.verifiedViewports.length).toBe(4);
  });

  it("handles loose manifests, screenshot buffers, and invalid structures", () => {
    const looseManifests = CANONICAL_VIEWPORTS.map((vp) => synthesizeDprAwareCompanionManifest(vp));
    const looseScreenshots = CANONICAL_VIEWPORTS.map((vp) => ({
      viewport: vp,
      buffer: new Uint8Array(2048),
      dpr: 2.0,
    }));
    const bundleRes = verifyMultiViewportManifests({
      manifests: looseManifests,
      screenshots: looseScreenshots,
    });
    expect(bundleRes.passed).toBe(true);

    const missingShot = auditSingleViewportManifest("desktop", looseManifests[0]!, undefined);
    expect(missingShot.passed).toBe(false);
    expect(missingShot.defects.some((d) => d.category === "missing_screenshot")).toBe(true);

    const invalidMan = auditSingleViewportManifest(
      "desktop",
      null as unknown as CompanionManifestV2,
      {
        viewport: "desktop",
        sizeBytes: 5000,
      },
    );
    expect(invalidMan.passed).toBe(false);
    expect(invalidMan.defects.some((d) => d.category === "invalid_manifest")).toBe(true);
  });
});
