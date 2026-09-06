import { describe, expect, test } from "bun:test";
import {
  ECOSYSTEM_31_ROLES,
  FORBIDDEN_QUARANTINE_TOOLS,
  THEME_PALETTES,
  VIEWPORT_PROFILES,
  get31AgentEcosystem,
  isQuarantinedOpticalValidator,
  validateAgentToolAccess,
  generateSyntheticUiFixtures,
  validateDomChannel,
  validateVisualChannel,
  validateDualChannel,
  generate12PermutationSurfaces,
  verifyThemePermutations,
  verifyDynamicMotion,
  type DomElementSnapshot,
  type MotionKeyframeSnapshot,
} from "../../olt/scripts/src/mind/implement-dual-channel-ui-validation-system-full-31-agent-ecosystem-overhaul-fb-1788281631793-qnza5.ts";

describe("Dual-Channel UI Validation System & Full 31-Agent Ecosystem", () => {
  test("defines exactly 31 roles across tiers and categories in ecosystem", () => {
    expect(ECOSYSTEM_31_ROLES.length).toBe(31);
    const ecosystem = get31AgentEcosystem();
    expect(ecosystem.length).toBe(31);

    const mind = ecosystem.find((e) => e.role === "mind");
    expect(mind?.tier).toBe(0);
    expect(mind?.category).toBe("supervisor");

    const coordinators = ecosystem.filter((e) => e.tier === 1);
    expect(coordinators.length).toBe(2);
    expect(coordinators.map((c) => c.role)).toEqual(["coordinator", "orchestrator"]);

    const tier2 = ecosystem.filter((e) => e.tier === 2);
    expect(tier2.length).toBe(20);
    expect(tier2.every((e) => e.category === "critic" || e.category === "auditor")).toBe(true);

    const tier3 = ecosystem.filter((e) => e.tier === 3);
    expect(tier3.length).toBe(8);
    expect(tier3.every((e) => e.category === "implementer" || e.category === "validator")).toBe(
      true,
    );
  });

  test("enforces tool quarantine for optical validators", () => {
    expect(isQuarantinedOpticalValidator("visual-auditor")).toBe(true);
    expect(isQuarantinedOpticalValidator("ui-visual-reviewer")).toBe(true);
    expect(isQuarantinedOpticalValidator("aesthetic-critic")).toBe(true);
    expect(isQuarantinedOpticalValidator("optical-validator")).toBe(true);
    expect(isQuarantinedOpticalValidator("mind")).toBe(false);
    expect(isQuarantinedOpticalValidator("implementer")).toBe(false);

    for (const tool of FORBIDDEN_QUARANTINE_TOOLS) {
      const access = validateAgentToolAccess("visual-auditor", tool);
      expect(access.permitted).toBe(false);
      expect(access.reason).toBeDefined();
    }

    const permitted = validateAgentToolAccess("visual-auditor", "capture_screenshot");
    expect(permitted.permitted).toBe(true);
    expect(permitted.reason).toBeUndefined();

    const implementerRun = validateAgentToolAccess("implementer", "run_command");
    expect(implementerRun.permitted).toBe(true);
  });

  test("generates 4 canonical synthetic UI data fixtures", () => {
    const sample = [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 3, name: "Gamma" },
    ];
    const fixtures = generateSyntheticUiFixtures(sample, "Custom backend outage");

    expect(fixtures.empty.state).toBe("empty");
    expect(fixtures.empty.data.length).toBe(0);
    expect(fixtures.empty.recordCount).toBe(0);
    expect(fixtures.empty.hasError).toBe(false);
    expect(fixtures.empty.errorMessage).toBeUndefined();

    expect(fixtures.partial.state).toBe("partial");
    expect(fixtures.partial.data.length).toBe(2);
    expect(fixtures.partial.recordCount).toBe(2);
    expect(fixtures.partial.hasError).toBe(false);

    expect(fixtures.loaded.state).toBe("loaded");
    expect(fixtures.loaded.data.length).toBe(3);
    expect(fixtures.loaded.recordCount).toBe(3);
    expect(fixtures.loaded.hasError).toBe(false);

    expect(fixtures.error.state).toBe("error");
    expect(fixtures.error.data.length).toBe(0);
    expect(fixtures.error.hasError).toBe(true);
    expect(fixtures.error.errorMessage).toBe("Custom backend outage");
  });

  test("validates DOM channel including hitbox size requirements", () => {
    const validSnapshots: readonly DomElementSnapshot[] = [
      { tagName: "div", id: "root", classes: ["app"], visible: true },
      {
        tagName: "button",
        id: "save",
        classes: ["btn"],
        visible: true,
        width: 48,
        height: 48,
        isInteractive: true,
      },
      {
        tagName: "a",
        id: "link-docs",
        classes: ["link"],
        visible: true,
        width: 60,
        height: 44,
        isInteractive: true,
      },
    ];
    const verdict = validateDomChannel(validSnapshots);
    expect(verdict.valid).toBe(true);
    expect(verdict.elementCount).toBe(3);
    expect(verdict.visibleCount).toBe(3);
    expect(verdict.minHitboxSatisfied).toBe(true);
    expect(verdict.issues.length).toBe(0);

    const tinyHitboxSnapshots: readonly DomElementSnapshot[] = [
      {
        tagName: "button",
        id: "btn-tiny",
        classes: ["small"],
        visible: true,
        width: 32,
        height: 32,
        isInteractive: true,
      },
    ];
    const tinyVerdict = validateDomChannel(tinyHitboxSnapshots);
    expect(tinyVerdict.valid).toBe(false);
    expect(tinyVerdict.minHitboxSatisfied).toBe(false);
    expect(tinyVerdict.issues.some((i) => i.includes("below minimum 44pt"))).toBe(true);

    const emptyVerdict = validateDomChannel([]);
    expect(emptyVerdict.valid).toBe(false);
    expect(emptyVerdict.issues.some((i) => i.includes("empty"))).toBe(true);

    const allHiddenSnapshots: readonly DomElementSnapshot[] = [
      { tagName: "div", classes: ["hide"], visible: false },
    ];
    const hiddenVerdict = validateDomChannel(allHiddenSnapshots);
    expect(hiddenVerdict.valid).toBe(false);
    expect(hiddenVerdict.visibleCount).toBe(0);
    expect(
      hiddenVerdict.issues.some((i) => i.includes("All elements in DOM snapshot are hidden")),
    ).toBe(true);
  });

  test("validates visual channel against contrast, CLS, aesthetic score, and heatmap diff", () => {
    const passResult = validateVisualChannel(5.2, 0.04, 88, 0.02);
    expect(passResult.valid).toBe(true);
    expect(passResult.contrastRatio).toBe(5.2);
    expect(passResult.aestheticScore).toBe(88);
    expect(passResult.heatmapDiff).toBe(0.02);
    expect(passResult.issues.length).toBe(0);

    const lowContrast = validateVisualChannel(3.1, 0.04, 80);
    expect(lowContrast.valid).toBe(false);
    expect(lowContrast.issues.some((i) => i.includes("Contrast ratio below"))).toBe(true);

    const highCls = validateVisualChannel(6.0, 0.22, 80);
    expect(highCls.valid).toBe(false);
    expect(highCls.issues.some((i) => i.includes("Cumulative layout shift exceeds"))).toBe(true);

    const lowAesthetic = validateVisualChannel(6.0, 0.02, 55);
    expect(lowAesthetic.valid).toBe(false);
    expect(lowAesthetic.issues.some((i) => i.includes("Visual aesthetic score below"))).toBe(true);

    const excessiveHeatmap = validateVisualChannel(6.0, 0.02, 85, 0.12);
    expect(excessiveHeatmap.valid).toBe(false);
    expect(excessiveHeatmap.issues.some((i) => i.includes("Perceptual heatmap diff"))).toBe(true);
  });

  test("computes dual channel composite scoring and handles regressions", () => {
    const passSnapshots: readonly DomElementSnapshot[] = [
      { tagName: "button", classes: ["btn"], visible: true, width: 50, height: 50 },
    ];
    const passingDual = validateDualChannel(passSnapshots, {
      contrastRatio: 7.0,
      layoutShift: 0.01,
      aestheticScore: 90,
      heatmapDiff: 0.01,
    });
    expect(passingDual.valid).toBe(true);
    expect(passingDual.compositeScore).toBe(95);

    const failingDual = validateDualChannel([], {
      contrastRatio: 2.0,
      layoutShift: 0.3,
      aestheticScore: 40,
    });
    expect(failingDual.valid).toBe(false);
    expect(failingDual.compositeScore).toBeLessThan(50);
  });

  test("verifies all 12 multi-theme permutation surfaces", () => {
    expect(THEME_PALETTES.length).toBe(3);
    expect(VIEWPORT_PROFILES.length).toBe(4);

    const surfaces = generate12PermutationSurfaces();
    expect(surfaces.length).toBe(12);

    const passingContrasts: Record<string, number> = {
      light: 5.5,
      dark: 6.0,
      "high-contrast": 8.0,
    };
    const verification = verifyThemePermutations(passingContrasts);
    expect(verification.totalSurfaces).toBe(12);
    expect(verification.passedCount).toBe(12);
    expect(verification.allPass).toBe(true);
    expect(verification.results.every((r) => r.valid)).toBe(true);

    const failingContrasts: Record<string, number> = {
      light: 5.0,
      dark: 3.5,
      "high-contrast": 5.0,
    };
    const failingVerification = verifyThemePermutations(failingContrasts);
    expect(failingVerification.allPass).toBe(false);
    expect(failingVerification.passedCount).toBeLessThan(12);
  });

  test("verifies two-phase dynamic motion and keyframe step-sampling", () => {
    const validKeyframes: readonly MotionKeyframeSnapshot[] = [
      { percentage: 0, visualScore: 85, settled: true },
      { percentage: 50, visualScore: 80, settled: false },
      { percentage: 100, visualScore: 92, settled: true },
    ];
    const motionPass = verifyDynamicMotion({
      measuredFps: 60,
      motionLayoutShift: 0.01,
      keyframes: validKeyframes,
    });
    expect(motionPass.valid).toBe(true);
    expect(motionPass.phase1FpsAuditPass).toBe(true);
    expect(motionPass.phase2KeyframePass).toBe(true);
    expect(motionPass.issues.length).toBe(0);

    const lowFps = verifyDynamicMotion({
      measuredFps: 42,
      motionLayoutShift: 0.01,
      keyframes: validKeyframes,
    });
    expect(lowFps.valid).toBe(false);
    expect(lowFps.phase1FpsAuditPass).toBe(false);
    expect(lowFps.issues.some((i) => i.includes("42fps < 60fps"))).toBe(true);

    const highShift = verifyDynamicMotion({
      measuredFps: 60,
      motionLayoutShift: 0.12,
      keyframes: validKeyframes,
    });
    expect(highShift.valid).toBe(false);
    expect(highShift.phase1FpsAuditPass).toBe(false);

    const missingKeyframes: readonly MotionKeyframeSnapshot[] = [
      { percentage: 0, visualScore: 85, settled: true },
      { percentage: 100, visualScore: 90, settled: true },
    ];
    const missingMidpoint = verifyDynamicMotion({
      measuredFps: 60,
      motionLayoutShift: 0.01,
      keyframes: missingKeyframes,
    });
    expect(missingMidpoint.valid).toBe(false);
    expect(missingMidpoint.phase2KeyframePass).toBe(false);
    expect(missingMidpoint.issues.some((i) => i.includes("contain 0%, 50%, and 100%"))).toBe(true);

    const poorMidpointScore: readonly MotionKeyframeSnapshot[] = [
      { percentage: 0, visualScore: 85, settled: true },
      { percentage: 50, visualScore: 45, settled: false },
      { percentage: 100, visualScore: 90, settled: true },
    ];
    const lowScoreMotion = verifyDynamicMotion({
      measuredFps: 60,
      motionLayoutShift: 0.01,
      keyframes: poorMidpointScore,
    });
    expect(lowScoreMotion.valid).toBe(false);
    expect(lowScoreMotion.phase2KeyframePass).toBe(false);
    expect(lowScoreMotion.issues.some((i) => i.includes("Keyframe at 50% scored < 70"))).toBe(true);
  });
});
