import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearInMemoryStrikes,
  determineStrikeAction,
  getStrikeRecord,
  recordStrike,
  renderMarkdownRemediationBrief,
  resetStrikes,
  setInMemoryStrikeMode,
  type SentinelViolation,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("sentinel:strike-ladder 3-strike escalation", () => {
  const dummyViolation: SentinelViolation = {
    code: "MISSING_FILE_SCOPED_TEST_RUN",
    severity: "CRITICAL",
    message: "File modified without executing file-scoped tests.",
    target_file: "src/utils.ts",
    remediation_cmd: "bun test tests/utils.test.ts",
    documentation_ref: "AGENTS.md#rule-4",
  };

  beforeEach(() => {
    setInMemoryStrikeMode(true);
    clearInMemoryStrikes();
  });

  test("determineStrikeAction maps 0 to NONE, 1 to ADVISE, 2 to BLOCK, >=3 to ESCALATE", () => {
    expect(determineStrikeAction(0)).toBe("NONE");
    expect(determineStrikeAction(1)).toBe("ADVISE");
    expect(determineStrikeAction(2)).toBe("BLOCK");
    expect(determineStrikeAction(3)).toBe("ESCALATE");
    expect(determineStrikeAction(4)).toBe("ESCALATE");
  });

  test("advances progressively through Strike 1, 2, and 3", () => {
    // Strike 1
    const s1 = recordStrike("worker_01", "implementer", [dummyViolation], "task-1");
    expect(s1.strike_count).toBe(1);
    expect(s1.frozen).toBe(false);
    expect(determineStrikeAction(s1.strike_count)).toBe("ADVISE");

    // Strike 2
    const s2 = recordStrike("worker_01", "implementer", [dummyViolation], "task-1");
    expect(s2.strike_count).toBe(2);
    expect(s2.frozen).toBe(false);
    expect(determineStrikeAction(s2.strike_count)).toBe("BLOCK");

    // Strike 3 (ESCALATE & FREEZE)
    const s3 = recordStrike("worker_01", "implementer", [dummyViolation], "task-1");
    expect(s3.strike_count).toBe(3);
    expect(s3.frozen).toBe(true);
    expect(determineStrikeAction(s3.strike_count)).toBe("ESCALATE");

    // Check persistence lookup
    const lookedUp = getStrikeRecord("worker_01");
    expect(lookedUp?.strike_count).toBe(3);
    expect(lookedUp?.frozen).toBe(true);
  });

  test("resetStrikes clears accumulated strikes", () => {
    recordStrike("worker_02", "implementer", [dummyViolation]);
    recordStrike("worker_02", "implementer", [dummyViolation]);
    expect(getStrikeRecord("worker_02")?.strike_count).toBe(2);

    resetStrikes("worker_02");
    expect(getStrikeRecord("worker_02")).toBeNull();
  });

  test("renders structured markdown remediation briefs for each strike level", () => {
    const brief1 = renderMarkdownRemediationBrief("worker_01", "implementer", 1, [dummyViolation]);
    expect(brief1).toContain("[SENTINEL_ADVISE : STRIKE 1/3]");
    expect(brief1).toContain("bun test tests/utils.test.ts");
    expect(brief1).toContain("IN-TURN COURSE CORRECTION");

    const brief2 = renderMarkdownRemediationBrief("worker_01", "implementer", 2, [dummyViolation]);
    expect(brief2).toContain("[SENTINEL_BLOCK : STRIKE 2/3]");
    expect(brief2).toContain("TOOL LOCK ENGAGED");

    const brief3 = renderMarkdownRemediationBrief("worker_01", "implementer", 3, [dummyViolation]);
    expect(brief3).toContain("[SENTINEL_ESCALATE : STRIKE 3/3]");
    expect(brief3).toContain("TASK LEASE FROZEN");
  });

  test("determineStrikeAction handles negative and extreme values safely", () => {
    expect(determineStrikeAction(-10)).toBe("NONE");
    expect(determineStrikeAction(-1)).toBe("NONE");
    expect(determineStrikeAction(10)).toBe("ESCALATE");
    expect(determineStrikeAction(1000)).toBe("ESCALATE");
  });

  test("maintains strict tenant isolation across concurrent worker agents", () => {
    recordStrike("worker_alpha", "implementer", [dummyViolation], "task-a");
    recordStrike("worker_alpha", "implementer", [dummyViolation], "task-a");
    recordStrike("worker_beta", "validator", [dummyViolation], "task-b");

    const alphaRecord = getStrikeRecord("worker_alpha");
    const betaRecord = getStrikeRecord("worker_beta");
    const unknownRecord = getStrikeRecord("worker_unknown");

    expect(alphaRecord?.strike_count).toBe(2);
    expect(alphaRecord?.frozen).toBe(false);
    expect(betaRecord?.strike_count).toBe(1);
    expect(betaRecord?.frozen).toBe(false);
    expect(unknownRecord).toBeNull();
  });

  test("idempotently resets non-existent and already-cleared agent strikes", () => {
    expect(() => resetStrikes("non_existent_worker")).not.toThrow();
    expect(getStrikeRecord("non_existent_worker")).toBeNull();

    recordStrike("worker_transient", "implementer", [dummyViolation]);
    expect(getStrikeRecord("worker_transient")?.strike_count).toBe(1);

    resetStrikes("worker_transient");
    expect(getStrikeRecord("worker_transient")).toBeNull();

    // Secondary reset call must remain a clean no-op
    expect(() => resetStrikes("worker_transient")).not.toThrow();
    expect(getStrikeRecord("worker_transient")).toBeNull();
  });

  test("renders markdown briefs with multiple distinct violations", () => {
    const secondViolation: SentinelViolation = {
      code: "LINE_BUDGET_EXCEEDED",
      severity: "CRITICAL",
      message: "File exceeds 300 LOC limit.",
      target_file: "src/big.ts",
      remediation_cmd: "refactor into smaller modules",
    };

    const brief = renderMarkdownRemediationBrief("worker_multi", "implementer", 2, [
      dummyViolation,
      secondViolation,
    ]);

    expect(brief).toContain("[SENTINEL_BLOCK : STRIKE 2/3]");
    expect(brief).toContain("MISSING_FILE_SCOPED_TEST_RUN");
    expect(brief).toContain("LINE_BUDGET_EXCEEDED");
    expect(brief).toContain("src/big.ts");
    expect(brief).toContain("src/utils.ts");
  });

  test("maintains post-freeze escalation durability across Strike 4 and 5", () => {
    recordStrike("worker_escalated", "implementer", [dummyViolation], "task-x");
    recordStrike("worker_escalated", "implementer", [dummyViolation], "task-x");
    recordStrike("worker_escalated", "implementer", [dummyViolation], "task-x");

    const s4 = recordStrike("worker_escalated", "implementer", [dummyViolation], "task-x");
    expect(s4.strike_count).toBe(4);
    expect(s4.frozen).toBe(true);
    expect(determineStrikeAction(s4.strike_count)).toBe("ESCALATE");

    const s5 = recordStrike("worker_escalated", "implementer", [dummyViolation], "task-x");
    expect(s5.strike_count).toBe(5);
    expect(s5.frozen).toBe(true);
    expect(determineStrikeAction(s5.strike_count)).toBe("ESCALATE");

    const lookedUp = getStrikeRecord("worker_escalated");
    const count = lookedUp ? lookedUp.strike_count : 0;
    const isFrozen = lookedUp ? lookedUp.frozen : false;
    expect(count).toBe(5);
    expect(isFrozen).toBe(true);
  });

  test("handles empty violations array safely without incrementing strikes", () => {
    const record = recordStrike("worker_clean", "implementer", []);
    expect(record.strike_count).toBe(0);
    expect(record.frozen).toBe(false);
    expect(record.active_violations).toHaveLength(0);
    expect(determineStrikeAction(record.strike_count)).toBe("NONE");
  });

  test("remediation brief renders safely across edge-case strike levels (0 and 4+)", () => {
    const briefZero = renderMarkdownRemediationBrief("worker_edge", "implementer", 0, [
      dummyViolation,
    ]);
    expect(briefZero).toContain("[SENTINEL_NONE : STRIKE 0/3]");
    expect(briefZero).toContain("ADVISORY");

    const briefFive = renderMarkdownRemediationBrief("worker_edge", "implementer", 5, [
      dummyViolation,
    ]);
    expect(briefFive).toContain("[SENTINEL_ESCALATE : STRIKE 5/3]");
    expect(briefFive).toContain("TASK LEASE FROZEN");
  });
});
