import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  calibrateDarkDepth,
  detectThemeFlash,
  getDefaultPermutationStagingEngine,
  resetDefaultPermutationStagingEngine,
  setDefaultPermutationStagingEngine,
  validateHighContrastBoundaries,
  MathematicalContrastPreFilter,
  PermutationGridManager,
  PermutationStagingEngine,
  ThematicGateVerifier,
  THEME_PERMUTATION_GRID,
} from "../fixtures.ts";

describe("Theming - Contrast Calculation & Thematic Gating", () => {
  beforeEach(() => {
    resetDefaultPermutationStagingEngine();
  });

  afterEach(() => {
    resetDefaultPermutationStagingEngine();
  });

  describe("9. Dedicated Round 4 Thematic Gating", () => {
    it("should approve Round 4 gate when all 12 permutations pass thematic integrity", () => {
      const gate = new ThematicGateVerifier();
      const allPermutations = THEME_PERMUTATION_GRID.map((p) => ({
        permutationId: p.permutationId,
        surfaceSeparationPassed: true,
        borderSubtletyPassed: true,
        iconClarityPassed: true,
        readabilityPassed: true,
        findings: ["Clean chromatic balance", "Clear border definition"],
      }));

      const report = gate.evaluateRound4Gate(allPermutations);
      expect(report.gateRound).toBe(4);
      expect(report.gateStatus).toBe("APPROVED");
      expect(report.passedPermutationsCount).toBe(12);
      expect(report.failedPermutationsCount).toBe(0);
      expect(report.blockingIssues.length).toBe(0);
    });

    it("should block Round 4 gate when any permutation fails or coverage is incomplete", () => {
      const gate = new ThematicGateVerifier();
      const partialPermutations = THEME_PERMUTATION_GRID.slice(0, 11).map((p, idx) => ({
        permutationId: p.permutationId,
        surfaceSeparationPassed: idx !== 0,
        borderSubtletyPassed: true,
        iconClarityPassed: true,
        readabilityPassed: true,
        findings: [],
      }));

      const report = gate.evaluateRound4Gate(partialPermutations);
      expect(report.gateStatus).toBe("BLOCKED");
      expect(report.blockingIssues.length).toBeGreaterThan(0);
      expect(report.blockingIssues.some((issue) => issue.includes("coverage"))).toBe(true);
      expect(report.blockingIssues.some((issue) => issue.includes("Surface separation"))).toBe(
        true,
      );
    });
  });

  describe("10. Chromatic Balancing & Real-Time Token Harmony", () => {
    it("should detect high Flash of Unstyled Theme (FOUT) risk", () => {
      const report = detectThemeFlash({
        initialHtmlBg: "#ffffff",
        loadedThemeBg: "#0b0f19",
        hasInlineThemeScript: false,
        transitionDurationMs: 400,
      });

      expect(report.flashRiskDetected).toBe(true);
      expect(report.riskLevel).toBe("high");
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain("FOUT");
    });

    it("should calibrate dark mode depth and verify monotonic elevation luminance", () => {
      const validDepth = calibrateDarkDepth({
        backgroundHex: "#0b0f19",
        surfaceHex: "#111827",
        elevatedHex: "#1f2937",
        overlayHex: "#374151",
      });

      expect(validDepth.monotonicProgression).toBe(true);
      expect(validDepth.issues.length).toBe(0);

      const invalidDepth = calibrateDarkDepth({
        backgroundHex: "#1f2937",
        surfaceHex: "#0b0f19",
        elevatedHex: "#111827",
      });

      expect(invalidDepth.monotonicProgression).toBe(false);
      expect(invalidDepth.issues.length).toBeGreaterThan(0);
    });

    it("should validate high-contrast boundaries for sharpness and minimum 7:1 contrast", () => {
      const sharpBoundary = validateHighContrastBoundaries({
        borderStyle: "solid",
        borderWidthPx: 2,
        borderColor: "#000000",
        backgroundColor: "#ffffff",
      });

      expect(sharpBoundary.boundarySharp).toBe(true);
      expect(sharpBoundary.contrastRatio).toBe(21.0);
      expect(sharpBoundary.issues.length).toBe(0);

      const weakBoundary = validateHighContrastBoundaries({
        borderStyle: "solid",
        borderWidthPx: 1,
        borderColor: "#94a3b8",
        backgroundColor: "#ffffff",
      });

      expect(weakBoundary.boundarySharp).toBe(false);
      expect(weakBoundary.issues[0]).toContain("7.0:1 AAA");
    });
  });

  describe("11. Permutation Staging Engine & Singletons", () => {
    it("should manage default singleton instance", () => {
      const defaultEngine = getDefaultPermutationStagingEngine();
      expect(defaultEngine).toBeInstanceOf(PermutationStagingEngine);
      expect(defaultEngine.gridManager).toBeInstanceOf(PermutationGridManager);
      expect(defaultEngine.preFilter).toBeInstanceOf(MathematicalContrastPreFilter);

      const customEngine = new PermutationStagingEngine();
      setDefaultPermutationStagingEngine(customEngine);
      expect(getDefaultPermutationStagingEngine()).toBe(customEngine);

      resetDefaultPermutationStagingEngine();
      expect(getDefaultPermutationStagingEngine()).not.toBe(customEngine);
    });
  });
});
