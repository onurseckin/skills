import { describe, it, expect } from "bun:test";
import {
  createPushbackHistory,
  appendPushbackRound,
  evaluateRepairProgression,
  isRepairExhausted,
  generateCorrectiveGuidance,
} from "../../../olt/scripts/src/authority/review/index.ts";

describe("Review Pushback - Multi-Round History & Repair Progression", () => {
  it("creates initial pushback history structure cleanly", () => {
    const history = createPushbackHistory("task-100", 3);
    expect(history.taskId).toBe("task-100");
    expect(history.currentRound).toBe(0);
    expect(history.maxRepairRounds).toBe(3);
    expect(history.rounds).toEqual([]);
    expect(history.isExhausted).toBe(false);
  });

  it("appends rounds and tracks current round count", () => {
    let history = createPushbackHistory("task-100", 3);

    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "validator-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing adversarial test",
      remediation: "Add negative assertions",
    });
    expect(history.currentRound).toBe(1);
    expect(history.rounds.length).toBe(1);
    expect(history.isExhausted).toBe(false);

    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "validator-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "Still failing edge case",
      remediation: "Fix null check",
    });
    expect(history.currentRound).toBe(2);
    expect(history.rounds.length).toBe(2);
  });

  it("detects when repair rounds are exhausted and generates corrective guidance", () => {
    let history = createPushbackHistory("task-100", 3);
    for (let r = 1; r <= 3; r++) {
      history = appendPushbackRound(history, {
        coordinatorId: "coord-1",
        validatorId: "validator-1",
        domain: "code-quality",
        cause: "substantive",
        observation: `Pushback round ${r}`,
        remediation: `Action ${r}`,
        rejectionReasons: [`Reason ${r}`],
        correctiveGuidance: [`Guidance ${r}`],
      });
    }

    expect(history.isExhausted).toBe(true);
    expect(isRepairExhausted(history.currentRound, history.maxRepairRounds)).toBe(true);

    const guidance = generateCorrectiveGuidance(history);
    expect(guidance.length).toBeGreaterThan(0);
  });

  it("evaluateRepairProgression accurately measures convergence across rounds", () => {
    let history = createPushbackHistory("task-200", 3);
    history = appendPushbackRound(history, {
      coordinatorId: "coord-1",
      validatorId: "validator-1",
      domain: "code-quality",
      cause: "substantive",
      observation: "3 defects",
      remediation: "fix all",
    });

    const progression = evaluateRepairProgression(history, {
      taskId: "task-200",
      summary: "Fixed all defects with unit tests",
    });
    expect(progression.progressMade).toBe(true);
    expect(progression.stagnant).toBe(false);
  });
});
