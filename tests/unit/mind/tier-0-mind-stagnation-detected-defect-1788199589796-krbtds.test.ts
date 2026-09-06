import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  RECORDED_IDLE_SECONDS,
  DEFAULT_STAGNATION_THRESHOLD_SECONDS,
  WAKEUP_MODE_B,
  validateDefectPreconditions,
  verifyDefectRemediation,
  evaluateMindLiveness,
  synthesizeModeBWakeupInjection,
  type DefectRemediationContext,
  type DefectRemediationResult,
  type MindStagnationTelemetry,
  type WakeupInjectionReceipt,
} from "../../../olt/scripts/src/mind/tier-0-mind-stagnation-detected-defect-1788199589796-krbtds.ts";

describe("Defect Remediation: defect-1788199589796-krbtds", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-1788199589796-krbtds");
    expect(ERROR_CODE).toBe("LIVE_STAGNATION_DETECTED");
    expect(DEFECT_TITLE).toContain("Tier 0 Mind Stagnation Detected");
    expect(RECORDED_IDLE_SECONDS).toBe(1229);
    expect(DEFAULT_STAGNATION_THRESHOLD_SECONDS).toBe(120);
    expect(WAKEUP_MODE_B).toBe("MODE_B_BACKLOG_REACTIVE");
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_task_1_3",
      role: "implementer",
      taskId: "task-1_3",
      state: "validating",
      sessionToken: "tok_live_defect_1788199589796_krbtds",
      scope: ["olt/scripts/src/mind/tier-0-mind-stagnation-detected-defect-1788199589796-krbtds.ts"],
      gateCommand:
        "bun test tests/unit/mind/tier-0-mind-stagnation-detected-defect-1788199589796-krbtds.test.ts",
      idleDurationSeconds: RECORDED_IDLE_SECONDS,
      thresholdSeconds: DEFAULT_STAGNATION_THRESHOLD_SECONDS,
    };
    expect(validateDefectPreconditions(validCtx)).toBe(true);
    const result: DefectRemediationResult = verifyDefectRemediation(validCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects unhandled idle state violating threshold", () => {
    const invalidCtx: DefectRemediationContext = {
      state: "unhandled_idle",
      idleDurationSeconds: 1229,
      thresholdSeconds: 120,
    };
    expect(validateDefectPreconditions(invalidCtx)).toBe(false);
    const result: DefectRemediationResult = verifyDefectRemediation(invalidCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("synthesizes Mode B wakeup injection when idle exceeds threshold", () => {
    const telemetry: MindStagnationTelemetry = {
      agentId: "tier-0-mind-primary",
      idleDurationSeconds: 1229,
      thresholdSeconds: 120,
      hasOpenWork: true,
      activeGrant: true,
    };
    const liveness = evaluateMindLiveness(telemetry);
    expect(liveness.isStagnant).toBe(true);
    expect(liveness.requiresWakeup).toBe(true);
    expect(liveness.mode).toBe(WAKEUP_MODE_B);

    const receipt: WakeupInjectionReceipt = synthesizeModeBWakeupInjection(telemetry);
    expect(receipt.defectId).toBe(DEFECT_ID);
    expect(receipt.errorCode).toBe(ERROR_CODE);
    expect(receipt.mode).toBe(WAKEUP_MODE_B);
    expect(receipt.idleSeconds).toBe(1229);
    expect(receipt.injectionSynthesized).toBe(true);
    expect(receipt.shockPrompt).toContain("MODE B WAKEUP INJECTION");
    expect(receipt.shockPrompt).toContain("1229s");
    expect(receipt.status).toBe("RESOLVED");
  });

  test("does not synthesize wakeup when idle is under threshold", () => {
    const nominalTelemetry: MindStagnationTelemetry = {
      agentId: "tier-0-mind-primary",
      idleDurationSeconds: 60,
      thresholdSeconds: 120,
      hasOpenWork: true,
      activeGrant: true,
    };
    const liveness = evaluateMindLiveness(nominalTelemetry);
    expect(liveness.isStagnant).toBe(false);
    expect(liveness.requiresWakeup).toBe(false);

    const receipt = synthesizeModeBWakeupInjection(nominalTelemetry);
    expect(receipt.injectionSynthesized).toBe(false);
    expect(receipt.status).toBe("OPEN");
  });
});
