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
} from "../../olt/scripts/src/sentinel/index.ts";

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
});
