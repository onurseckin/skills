import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  REQUIRED_COGNITIVE_ROUNDS,
  evaluateCognitiveReviewFinalization,
  recordCognitiveProbe,
  type CognitiveProtocolContext,
  type CognitiveProtocolResult,
} from "../../olt/scripts/src/mind/defect-cli-1788680018946-kct3qk.ts";

describe("Defect Remediation: defect-cli-1788680018946-kct3qk", () => {
  test("exports expected defect metadata and required cognitive round constants", () => {
    expect(DEFECT_ID).toBe("defect-cli-1788680018946-kct3qk");
    expect(ERROR_CODE).toBe("INVALID_STATE");
    expect(DEFECT_TITLE).toContain("task-3");
    expect(REQUIRED_COGNITIVE_ROUNDS).toBe(5);
  });

  test("rejects review finalization when cognitive rounds are insufficient", () => {
    const ctx: CognitiveProtocolContext = {
      taskId: "task-3",
      completedRounds: 1,
      requiredRounds: 5,
    };
    const result: CognitiveProtocolResult = evaluateCognitiveReviewFinalization(ctx);
    expect(result.remediated).toBe(true);
    expect(result.finalized).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("1/5 required cognitive rounds");
  });

  test("advances cognitive round upon recording cognitive probe", () => {
    const initialCtx: CognitiveProtocolContext = {
      taskId: "task-3",
      completedRounds: 4,
      requiredRounds: 5,
      probeKind: "cognitive",
      probeResolution: "Addressed cognitive edge case verification.",
    };
    const result: CognitiveProtocolResult = recordCognitiveProbe(initialCtx);
    expect(result.remediated).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.currentRounds).toBe(5);
    expect(result.errors.length).toBe(0);
  });

  test("allows review finalization when all 5 cognitive rounds are completed", () => {
    const ctx: CognitiveProtocolContext = {
      taskId: "task-3",
      completedRounds: 5,
      requiredRounds: 5,
    };
    const result: CognitiveProtocolResult = evaluateCognitiveReviewFinalization(ctx);
    expect(result.remediated).toBe(true);
    expect(result.finalized).toBe(true);
    expect(result.errors.length).toBe(0);
  });
});
