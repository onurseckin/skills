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
} from "../../../../olt/scripts/src/heuristics/multi-viewport-manifest/index.ts";
import type {
  CompanionManifestV2,
  EvaluatedCriterion,
} from "../../../../olt/scripts/src/capture/validator/types.ts";

describe("Extended Heuristics: Multi-Viewport Manifest & 4 Pillars Hierarchy", () => {
  const createMockCriterion = (
    id: string,
    pillar: string,
    passed: boolean,
  ): EvaluatedCriterion => ({
    id,
    pillar: pillar as EvaluatedCriterion["pillar"],
    name: `Criterion ${id}`,
    passed,
    details: "Evaluated element geometry against design token scale with 0 defects",
    evidence: "Evaluated 12 element snapshots in viewport with 0 violations found",
  });

  const createMockManifest = (viewport: string, passed = true): CompanionManifestV2 => ({
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
      createMockCriterion("CRIT-MECH-APCA", "mechanical", passed),
      createMockCriterion("CRIT-COGN-FITTS", "cognitive", passed),
      createMockCriterion("CRIT-PROD-TOKENS", "product", passed),
      createMockCriterion("CRIT-UX-FOCUS", "ux", passed),
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

  const validScreenshot = (viewport: string): ScreenshotArtifact => ({
    viewport,
    path: `/screenshots/${viewport}.png`,
    sizeBytes: 15420,
  });

  it("certifies complete 4-viewport bundle with all 4 mandatory pillars and valid screenshots", () => {
    const input: MultiViewportBundleInput = {
      entries: CANONICAL_VIEWPORTS.map((vp) => ({
        viewport: vp,
        manifest: createMockManifest(vp, true),
        screenshot: validScreenshot(vp),
      })),
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(true);
    expect(result.verifiedViewports.length).toBe(4);
    expect(result.missingViewports.length).toBe(0);
    expect(result.defects.length).toBe(0);
    expect(result.pillarMatrix["mobile"]?.mechanical).toBe(true);
    expect(result.pillarMatrix["tablet"]?.cognitive).toBe(true);
    expect(result.pillarMatrix["desktop"]?.product).toBe(true);
    expect(result.pillarMatrix["desktop-wide"]?.ux).toBe(true);
  });

  it("flags missing canonical viewport", () => {
    const input: MultiViewportBundleInput = {
      entries: [
        { viewport: "mobile", manifest: createMockManifest("mobile", true), screenshot: validScreenshot("mobile") },
        { viewport: "tablet", manifest: createMockManifest("tablet", true), screenshot: validScreenshot("tablet") },
        { viewport: "desktop", manifest: createMockManifest("desktop", true), screenshot: validScreenshot("desktop") },
      ],
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(false);
    expect(result.missingViewports).toContain("desktop-wide");
    expect(result.defects.some((d) => d.category === "missing_manifest")).toBe(true);
  });

  it("flags undersized dummy screenshots (< 1024 bytes)", () => {
    const audit = auditSingleViewportManifest("mobile", createMockManifest("mobile", true), {
      viewport: "mobile",
      sizeBytes: 67,
    });

    expect(audit.passed).toBe(false);
    expect(audit.hasValidScreenshot).toBe(false);
    expect(audit.defects.some((d) => d.category === "undersized_screenshot")).toBe(true);
  });

  it("flags manifest missing any of the 4 mandatory pillars", () => {
    const brokenManifest: CompanionManifestV2 = {
      ...createMockManifest("mobile", true),
      criteria: [
        createMockCriterion("CRIT-MECH-1", "mechanical", true),
        createMockCriterion("CRIT-COGN-1", "cognitive", true),
      ],
      pillars: {
        mechanical: { pillar: "mechanical", passed: true, defects: [], evaluatedCount: 1 },
        cognitive: { pillar: "cognitive", passed: true, defects: [], evaluatedCount: 1 },
        custom: { pillar: "custom", passed: true, defects: [], evaluatedCount: 1 },
      },
    };

    const audit = auditSingleViewportManifest("mobile", brokenManifest, validScreenshot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.missingPillars).toContain("product");
    expect(audit.missingPillars).toContain("ux");
    expect(audit.defects.some((d) => d.category === "missing_pillar")).toBe(true);
  });

  it("flags criteria with non-boolean pass states or empty details & evidence", () => {
    const rawManifest = {
      version: "2.0",
      viewport: "mobile",
      criteria: [
        { id: "CRIT-BAD-1", pillar: "mechanical", passed: "yes", details: "Details text", evidence: "Evidence text 24px" },
        { id: "CRIT-BAD-2", pillar: "cognitive", passed: true, details: "   ", evidence: "" },
        { id: "CRIT-BAD-3", pillar: "product", passed: false, details: "Mismatch", evidence: "Mismatch on 2 items" },
        { id: "CRIT-OK-4", pillar: "ux", passed: true, details: "Valid details", evidence: "Verified 4 items" },
      ],
    };

    const audit = auditSingleViewportManifest("mobile", rawManifest, validScreenshot("mobile"));
    expect(audit.passed).toBe(false);
    expect(audit.defects.some((d) => d.category === "missing_boolean_passed")).toBe(true);
    expect(audit.defects.some((d) => d.category === "empty_details_evidence")).toBe(true);
    expect(audit.defects.some((d) => d.category === "criterion_failed")).toBe(true);
  });

  it("normalizes pillar strings accurately", () => {
    expect(normalizePillar("mechanical")).toBe("mechanical");
    expect(normalizePillar("MECH")).toBe("mechanical");
    expect(normalizePillar("Cognitive")).toBe("cognitive");
    expect(normalizePillar("Product")).toBe("product");
    expect(normalizePillar("UX")).toBe("ux");
    expect(normalizePillar("ux ergonomics")).toBe("ux");
    expect(normalizePillar("ux_ergonomics")).toBe("ux");
    expect(normalizePillar("ux-ergonomics")).toBe("ux");
    expect(normalizePillar("unknown")).toBeNull();
  });

  it("evaluates CANONICAL_VIEWPORT_SPECS and computePhysicalViewportMetrics across viewports and DPRs", () => {
    const wide1x = computePhysicalViewportMetrics("desktop-wide", 1.0);
    expect(wide1x.cssWidth).toBe(1920);
    expect(wide1x.cssHeight).toBe(1080);
    expect(wide1x.physicalWidth).toBe(1920);
    expect(wide1x.isRetinaOrHiDpi).toBe(false);

    const wide2x = computePhysicalViewportMetrics("desktop-wide", 2.0);
    expect(wide2x.physicalWidth).toBe(3840);
    expect(wide2x.physicalHeight).toBe(2160);
    expect(wide2x.isRetinaOrHiDpi).toBe(true);

    const desk1x = computePhysicalViewportMetrics("desktop", 1.0);
    expect(desk1x.physicalWidth).toBe(1440);

    const desk2x = computePhysicalViewportMetrics("desktop", 2.0);
    expect(desk2x.physicalWidth).toBe(2880);
    expect(desk2x.isRetinaOrHiDpi).toBe(true);

    const tablet2x = computePhysicalViewportMetrics("tablet");
    expect(tablet2x.physicalWidth).toBe(1536);
    expect(tablet2x.isRetinaOrHiDpi).toBe(true);

    const mobile3x = computePhysicalViewportMetrics("mobile");
    expect(mobile3x.physicalWidth).toBe(1170);
    expect(mobile3x.isRetinaOrHiDpi).toBe(true);
  });

  it("synthesizes DPR-aware companion manifest with synthesizeDprAwareCompanionManifest", () => {
    for (const vp of CANONICAL_VIEWPORTS) {
      const manifest = synthesizeDprAwareCompanionManifest(vp);
      expect(manifest.verdict).toBe("CERTIFIED");
      expect(manifest.viewport).toBe(vp);
      expect(manifest.criteria.length).toBeGreaterThanOrEqual(4);
      expect(manifest.criteria.every((c) => c.passed)).toBe(true);

      const audit = auditSingleViewportManifest(vp, manifest, { viewport: vp, sizeBytes: 4096 });
      expect(audit.passed).toBe(true);
      expect(audit.physicalMetrics).toBeDefined();
      expect(audit.dpr).toBe(CANONICAL_VIEWPORT_SPECS[vp].defaultDpr);
    }
  });

  it("verifies multi-viewport bundle with DPR overrides and per-entry DPR settings", () => {
    const input: MultiViewportBundleInput = {
      entries: [
        { viewport: "desktop-wide", manifest: synthesizeDprAwareCompanionManifest("desktop-wide", { dpr: 2.0 }), screenshot: { viewport: "desktop-wide", sizeBytes: 20000, dpr: 2.0 }, devicePixelRatio: 2.0 },
        { viewport: "desktop", manifest: synthesizeDprAwareCompanionManifest("desktop", { dpr: 1.0 }), screenshot: { viewport: "desktop", sizeBytes: 15000, dpr: 1.0 }, devicePixelRatio: 1.0 },
        { viewport: "tablet", manifest: synthesizeDprAwareCompanionManifest("tablet", { dpr: 2.0 }), screenshot: { viewport: "tablet", sizeBytes: 12000, dpr: 2.0 }, devicePixelRatio: 2.0 },
        { viewport: "mobile", manifest: synthesizeDprAwareCompanionManifest("mobile", { dpr: 3.0 }), screenshot: { viewport: "mobile", sizeBytes: 10000, dpr: 3.0 }, devicePixelRatio: 3.0 },
      ],
      dprOverrides: { "desktop-wide": 2.0, desktop: 1.0, tablet: 2.0, mobile: 3.0 },
    };

    const result = verifyMultiViewportManifests(input);
    expect(result.passed).toBe(true);
    expect(result.verifiedViewports.length).toBe(4);

    const desktopWideAudit = result.viewportAudits.find((a) => a.viewport === "desktop-wide");
    expect(desktopWideAudit?.physicalMetrics?.physicalWidth).toBe(3840);
  });
});
