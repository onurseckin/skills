import { describe, expect, it, test } from "bun:test";
import {
  AUDIT_QUESTIONS,
  AUDIT_QUESTION_IDS,
  normalizeQuestionId,
  generateCleanAnswers,
  validateAuditAnswers,
} from "./audit-fixture.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
describe("Phase 5 W5.2 - Mind Audit Questionnaire & Verification", () => {
  describe("Audit Questionnaire Structure & Normalization", () => {
    test("defines exactly 8 fixed questions per PHASE-5 §3.2 and PLAN.md §12.2", () => {
      expect(AUDIT_QUESTIONS).toHaveLength(8);
      expect(AUDIT_QUESTION_IDS).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]);

      const questionKeys = AUDIT_QUESTIONS.map((q) => q.key);
      expect(questionKeys).toContain("pulse_gaps");
      expect(questionKeys).toContain("witness_defects");
      expect(questionKeys).toContain("charter_goals");
      expect(questionKeys).toContain("value_consistency");
      expect(questionKeys).toContain("scope_violations");
      expect(questionKeys).toContain("never_unattended");
      expect(questionKeys).toContain("declined_candidates");
      expect(questionKeys).toContain("charter_digest");
    });

    test("normalizes question IDs across various alias representations", () => {
      expect(normalizeQuestionId("Q1")).toBe("Q1");
      expect(normalizeQuestionId("1")).toBe("Q1");
      expect(normalizeQuestionId("pulse_gaps")).toBe("Q1");
      expect(normalizeQuestionId("pulse-gaps")).toBe("Q1");
      expect(normalizeQuestionId("Q8")).toBe("Q8");
      expect(normalizeQuestionId("8")).toBe("Q8");
      expect(normalizeQuestionId("charter_digest")).toBe("Q8");
      expect(normalizeQuestionId("unknown-q")).toBeUndefined();
    });
  });

  describe("Command ID Requirement & Answers Validation", () => {
    test("accepts valid 8-question answer list with command IDs", () => {
      const answers = generateCleanAnswers();
      const validated = validateAuditAnswers(answers);
      expect(validated).toHaveLength(8);
      expect(validated[0]!.question_id).toBe("Q1");
      expect(validated[0]!.command_id).toBe("cmd-101");
      expect(validated[0]!.verdict).toBe("pass");
    });

    test("refuses answers when any question lacks a command ID", () => {
      const missingCmdAnswers = [
        "Q1::pass",
        "Q2:cmd-102:pass",
        "Q3:cmd-103:pass",
        "Q4:cmd-104:pass",
        "Q5:cmd-105:pass",
        "Q6:cmd-106:pass",
        "Q7:cmd-107:pass",
        "Q8:cmd-108:pass",
      ];

      expect(() => validateAuditAnswers(missingCmdAnswers)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(missingCmdAnswers)).toThrow(
        /must cite a non-empty command id/,
      );
    });

    test("refuses answers when fewer than 8 questions are answered", () => {
      const incompleteAnswers = ["Q1:cmd-101:pass", "Q2:cmd-102:pass", "Q3:cmd-103:pass"];

      expect(() => validateAuditAnswers(incompleteAnswers)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(incompleteAnswers)).toThrow(
        /missing answers for audit questionnaire/,
      );
    });

    test("accepts object format with question IDs or keys", () => {
      const answerObj = {
        Q1: { command_id: "cmd-1", verdict: "pass", statement: "Clean" },
        Q2: { command_id: "cmd-2", verdict: "pass" },
        Q3: { command_id: "cmd-3", verdict: "pass" },
        Q4: { command_id: "cmd-4", verdict: "pass" },
        Q5: { command_id: "cmd-5", verdict: "pass" },
        Q6: { command_id: "cmd-6", verdict: "pass" },
        Q7: { command_id: "cmd-7", verdict: "pass" },
        Q8: { command_id: "cmd-8", verdict: "pass" },
      };

      const validated = validateAuditAnswers(answerObj);
      expect(validated).toHaveLength(8);
      expect(validated[0]!.command_id).toBe("cmd-1");
    });

    test("refuses object format when command ID is empty string", () => {
      const answerObj = {
        Q1: { command_id: "   ", verdict: "pass" },
        Q2: { command_id: "cmd-2", verdict: "pass" },
        Q3: { command_id: "cmd-3", verdict: "pass" },
        Q4: { command_id: "cmd-4", verdict: "pass" },
        Q5: { command_id: "cmd-5", verdict: "pass" },
        Q6: { command_id: "cmd-6", verdict: "pass" },
        Q7: { command_id: "cmd-7", verdict: "pass" },
        Q8: { command_id: "cmd-8", verdict: "pass" },
      };

      expect(() => validateAuditAnswers(answerObj)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(answerObj)).toThrow(/must cite a non-empty command id/);
    });
  });
});
