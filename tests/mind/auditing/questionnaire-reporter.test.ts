import { describe, expect, it } from "bun:test";
import type { RunState } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAuditAllowsPulseOpen,
  checkAuditBlocksPulse,
  validateAuditAnswers,
} from "../../../olt/scripts/src/mind/auditing/questionnaire/reporter.ts";

describe("Questionnaire Reporter & Validation Subsystem", () => {
  describe("validateAuditAnswers", () => {
    it("rejects non-object or null input", () => {
      expect(() => validateAuditAnswers(null)).toThrow(HarnessError);
      expect(() => validateAuditAnswers("not an object")).toThrow(
        /audit answers must be an object or an array/,
      );
    });

    it("validates array of string formatted answers (Q:CMD:VERDICT:STATEMENT)", () => {
      const stringAnswers = [
        "Q1:cmd-1:pass:all clear",
        "Q2:cmd-2:fail:found defect",
        "Q3:cmd-3:finding:flagged finding",
        "Q4:cmd-4:failed:assertion failure",
        "Q5:cmd-5:pass",
        "Q6:cmd-6:pass",
        "Q7:cmd-7:pass",
        "Q8:cmd-8:pass",
      ];

      const validated = validateAuditAnswers(stringAnswers);
      expect(validated.length).toBe(8);
      expect(validated[0]?.question_id).toBe("Q1");
      expect(validated[0]?.verdict).toBe("pass");
      expect(validated[0]?.statement).toBe("all clear");
      expect(validated[1]?.verdict).toBe("fail");
      expect(validated[2]?.verdict).toBe("fail");
      expect(validated[3]?.verdict).toBe("fail");
      expect(validated[4]?.statement).toBeUndefined();
    });

    it("throws on invalid question identifier or empty command id in string array", () => {
      expect(() =>
        validateAuditAnswers([
          "Q99:cmd-1:pass",
          "Q2:cmd-2:pass",
          "Q3:cmd-3:pass",
          "Q4:cmd-4:pass",
          "Q5:cmd-5:pass",
          "Q6:cmd-6:pass",
          "Q7:cmd-7:pass",
          "Q8:cmd-8:pass",
        ]),
      ).toThrow(/unrecognized question identifier 'Q99'/);

      expect(() =>
        validateAuditAnswers([
          "Q1:  :pass",
          "Q2:cmd-2:pass",
          "Q3:cmd-3:pass",
          "Q4:cmd-4:pass",
          "Q5:cmd-5:pass",
          "Q6:cmd-6:pass",
          "Q7:cmd-7:pass",
          "Q8:cmd-8:pass",
        ]),
      ).toThrow(/audit answer for Q1 must cite a non-empty command id/);
    });

    it("validates array of object formatted answers with question and command aliases", () => {
      const objAnswers = [
        { question_id: "Q1", command_id: "cmd-1", verdict: "pass", statement: "good" },
        { question: "Q2", commandId: "cmd-2", verdict: "fail", findings: ["err1"] },
        { id: "Q3", command: "cmd-3", verdict: "finding" },
        { question_id: "Q4", command_id: "cmd-4", verdict: "failed" },
        { question_id: "Q5", command_id: "cmd-5" }, // default pass
        { question_id: "Q6", command_id: "cmd-6", verdict: "pass" },
        { question_id: "Q7", command_id: "cmd-7", verdict: "pass" },
        { question_id: "Q8", command_id: "cmd-8", verdict: "pass" },
      ];

      const validated = validateAuditAnswers(objAnswers);
      expect(validated.length).toBe(8);
      expect(validated[1]?.findings).toEqual(["err1"]);
      expect(validated[4]?.verdict).toBe("pass");

      // Test errors in object array
      expect(() => validateAuditAnswers([{ question_id: "invalid-q", command_id: "c" }])).toThrow(
        /unrecognized question identifier/,
      );

      expect(() => validateAuditAnswers([{ question_id: "Q1", command_id: "   " }])).toThrow(
        /must cite a non-empty command id/,
      );
    });

    it("validates dictionary/record format with string and object values", () => {
      const recordAnswers = {
        Q1: "cmd-1:pass",
        Q2: "cmd-2:fail",
        Q3: { command_id: "cmd-3", verdict: "fail", findings: ["f3"] },
        Q4: { commandId: "cmd-4", verdict: "pass", statement: "s4" },
        Q5: { command: "cmd-5", verdict: "finding" },
        Q6: "cmd-6:pass",
        Q7: "cmd-7:pass",
        Q8: "cmd-8:pass",
        unrelated_key: "ignore-me",
      };

      const validated = validateAuditAnswers(recordAnswers);
      expect(validated.length).toBe(8);
      expect(validated[0]?.command_id).toBe("cmd-1");
      expect(validated[2]?.findings).toEqual(["f3"]);
      expect(validated[3]?.statement).toBe("s4");

      // Test errors in record values
      expect(() => validateAuditAnswers({ Q1: "  :pass" })).toThrow(
        /must cite a non-empty command id/,
      );
      expect(() => validateAuditAnswers({ Q1: { command_id: " " } })).toThrow(
        /must cite a non-empty command id/,
      );
    });

    it("throws when any of the 8 mandatory questions are missing", () => {
      const partialAnswers = ["Q1:cmd-1:pass", "Q2:cmd-2:pass", "Q3:cmd-3:pass"];

      expect(() => validateAuditAnswers(partialAnswers)).toThrow(
        /missing answers for audit questionnaire: Q4, Q5, Q6, Q7, Q8/,
      );
    });
  });

  describe("checkAuditBlocksPulse & assertAuditAllowsPulseOpen", () => {
    it("detects halted state via mind.halted and audit status/verdict", () => {
      const haltedByMind = {
        mind: { halted: true, halt_reason: "critical invariant breach" },
      } as unknown as RunState;
      const res1 = checkAuditBlocksPulse(haltedByMind);
      expect(res1.blocked).toBe(true);
      expect(res1.outcome).toBe("halted");
      expect(res1.reason).toContain("critical invariant breach");

      const haltedByAuditStatus = {
        audit: { status: "halted", summary: "audit stopped mind" },
      } as unknown as RunState;
      const res2 = checkAuditBlocksPulse(haltedByAuditStatus);
      expect(res2.blocked).toBe(true);
      expect(res2.outcome).toBe("halted");
      expect(res2.reason).toContain("audit stopped mind");

      const haltedByVerdictDefault = {
        audit: { last_verdict: "halt" },
      } as unknown as RunState;
      const res3 = checkAuditBlocksPulse(haltedByVerdictDefault);
      expect(res3.blocked).toBe(true);
      expect(res3.reason).toContain("mind halted by audit verdict");
    });

    it("detects open findings and changes_requested blocking conditions", () => {
      const withOpenFindings = {
        audit: { open_findings: ["finding-1", "finding-2"] },
      } as unknown as RunState;
      const resFindings = checkAuditBlocksPulse(withOpenFindings);
      expect(resFindings.blocked).toBe(true);
      expect(resFindings.outcome).toBe("blocked");
      expect(resFindings.reason).toContain("finding-1; finding-2");

      const withChangesRequested = {
        audit: { status: "changes_requested" },
      } as unknown as RunState;
      const resChanges = checkAuditBlocksPulse(withChangesRequested);
      expect(resChanges.blocked).toBe(true);
      expect(resChanges.outcome).toBe("blocked");
      expect(resChanges.reason).toContain("audit verdict requested changes");

      const withVerdictChangesRequested = {
        audit: { last_verdict: "changes_requested" },
      } as unknown as RunState;
      const resVerdictChanges = checkAuditBlocksPulse(withVerdictChangesRequested);
      expect(resVerdictChanges.blocked).toBe(true);
    });

    it("allows pulse open when audit state is clean and throws HarnessError when blocked", () => {
      const cleanState = {
        audit: { status: "passed", open_findings: [] },
      } as unknown as RunState;

      const resClean = checkAuditBlocksPulse(cleanState);
      expect(resClean.blocked).toBe(false);

      expect(() => assertAuditAllowsPulseOpen(cleanState)).not.toThrow();

      const blockedState = {
        audit: { status: "changes_requested" },
      } as unknown as RunState;
      expect(() => assertAuditAllowsPulseOpen(blockedState)).toThrow(HarnessError);
    });
  });
});
