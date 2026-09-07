import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { validateFeedbackResolutionProof } from "../../../../olt/scripts/src/mind/feedback/queue/storage.ts";

describe("Mind Feedback Resolution Proof Storage Suite (todo-storage.test.ts)", () => {
  describe("Valid Resolution Proof Normalization", () => {
    it("normalizes a minimal valid resolution proof with task_id and ISO date", () => {
      const proof = validateFeedbackResolutionProof({
        task_id: "task-min-1",
        resolved_at: "2026-09-01T12:00:00.000Z",
      });

      expect(proof.task_id).toBe("task-min-1");
      expect(proof.resolved_at).toBe("2026-09-01T12:00:00.000Z");
      expect(proof.test_path).toBeUndefined();
      expect(proof.commit_sha).toBeUndefined();
    });

    it("normalizes full resolution proof across all empirical fields and runtime alias", () => {
      const fullInput = {
        task_id: "task-full-101",
        resolved_at: "2026-09-01T14:30:00.000Z",
        test_path: "tests/mind/feedback/queue.test.ts",
        test_assertion: "verifies sub-10ms virtual memory transactions",
        assertions: ["asserts pure RAM", "asserts 0 disk writes"],
        runtime: 4, // runtime alias for runtime_ms
        commit_sha: "fedcba987654",
        proof_summary: "Validated in-memory queue storage",
        verified_by: "validator_mind_feedback_perf",
        remediation_notes: "Converted all fs calls to VirtualMemoryFS",
        metadata: { engine: "virtual-fs", session: "session-01" },
      };

      const proof = validateFeedbackResolutionProof(fullInput);
      expect(proof.task_id).toBe("task-full-101");
      expect(proof.test_path).toBe("tests/mind/feedback/queue.test.ts");
      expect(proof.test_assertion).toBe("verifies sub-10ms virtual memory transactions");
      expect(proof.assertions).toEqual(["asserts pure RAM", "asserts 0 disk writes"]);
      expect(proof.runtime_ms).toBe(4);
      expect(proof.commit_sha).toBe("fedcba987654");
      expect(proof.verified_by).toBe("validator_mind_feedback_perf");
      expect(proof.metadata?.["engine"]).toBe("virtual-fs");
    });

    it("handles assertions as number and string cleanly", () => {
      const proofWithNum = validateFeedbackResolutionProof({
        task_id: "task-num",
        resolved_at: "2026-09-01T10:00:00.000Z",
        assertions: 15,
      });
      expect(proofWithNum.assertions).toBe(15);

      const proofWithStr = validateFeedbackResolutionProof({
        task_id: "task-str",
        resolved_at: "2026-09-01T10:00:00.000Z",
        assertions: "12 passed",
      });
      expect(proofWithStr.assertions).toBe("12 passed");
    });
  });

  describe("Validation Guards & Failure Modes", () => {
    it("rejects non-object proof inputs with INVALID_ARGUMENT", () => {
      expect(() => validateFeedbackResolutionProof(null)).toThrow(HarnessError);
      expect(() => validateFeedbackResolutionProof("invalid string")).toThrow(HarnessError);
      expect(() => validateFeedbackResolutionProof([1, 2, 3])).toThrow(HarnessError);
    });

    it("rejects missing or empty task_id with INVALID_ARGUMENT", () => {
      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "",
          resolved_at: "2026-09-01T10:00:00.000Z",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "   \t  ",
          resolved_at: "2026-09-01T10:00:00.000Z",
        }),
      ).toThrow(HarnessError);
    });

    it("rejects invalid or unparseable resolved_at timestamps", () => {
      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "task-bad-date",
          resolved_at: "unparseable-date-string",
        }),
      ).toThrow(HarnessError);

      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "task-no-date",
          resolved_at: "",
        }),
      ).toThrow(HarnessError);
    });

    it("rejects invalid type assertions or runtime_ms", () => {
      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "task-bad-assert",
          resolved_at: "2026-09-01T10:00:00.000Z",
          assertions: { count: 5 }, // objects invalid for assertions
        }),
      ).toThrow(HarnessError);

      expect(() =>
        validateFeedbackResolutionProof({
          task_id: "task-bad-runtime",
          resolved_at: "2026-09-01T10:00:00.000Z",
          runtime_ms: true, // boolean invalid for runtime
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Option Gates (requireTestPath & requireCommitSha)", () => {
    it("enforces requireTestPath minimum length 3 gate", () => {
      const proofWithoutPath = {
        task_id: "task-gate-path",
        resolved_at: "2026-09-01T10:00:00.000Z",
      };

      expect(() =>
        validateFeedbackResolutionProof(proofWithoutPath, { requireTestPath: true }),
      ).toThrow(HarnessError);

      const proofWithShortPath = {
        ...proofWithoutPath,
        test_path: "ab", // < 3 characters
      };
      expect(() =>
        validateFeedbackResolutionProof(proofWithShortPath, { requireTestPath: true }),
      ).toThrow(HarnessError);

      const proofWithValidPath = {
        ...proofWithoutPath,
        test_path: "tests/a.test.ts",
      };
      expect(() =>
        validateFeedbackResolutionProof(proofWithValidPath, { requireTestPath: true }),
      ).not.toThrow();
    });

    it("enforces requireCommitSha minimum length 7 gate", () => {
      const proofWithoutSha = {
        task_id: "task-gate-sha",
        resolved_at: "2026-09-01T10:00:00.000Z",
      };

      expect(() =>
        validateFeedbackResolutionProof(proofWithoutSha, { requireCommitSha: true }),
      ).toThrow(HarnessError);

      const proofWithShortSha = {
        ...proofWithoutSha,
        commit_sha: "123456", // 6 characters (< 7)
      };
      expect(() =>
        validateFeedbackResolutionProof(proofWithShortSha, { requireCommitSha: true }),
      ).toThrow(HarnessError);

      const proofWithValidSha = {
        ...proofWithoutSha,
        commit_sha: "1234567", // 7 characters
      };
      expect(() =>
        validateFeedbackResolutionProof(proofWithValidSha, { requireCommitSha: true }),
      ).not.toThrow();
    });
  });
});
