import { describe, expect, test } from "bun:test";
import {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  type CriticFindingDetail,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";

describe("Critic Feedback: Normalization, Pair Selection & Repeat Detection", () => {
  describe("deriveCounterfactualRequirement", () => {
    test("derives counterfactual requirement from observation and remediation", () => {
      const counterfactual = deriveCounterfactualRequirement(
        "Memory leak in worker pool on shutdown",
        "Call pool.drain() during SIGTERM handler",
      );
      expect(counterfactual).toContain("Counterfactual Requirement:");
      expect(counterfactual).toContain("Call pool.drain() during SIGTERM handler");
      expect(counterfactual).toContain("Memory leak in worker pool on shutdown");
    });

    test("preserves explicit counterfactual if already provided", () => {
      const explicit = "Invariant: Heap memory must not grow by >1MB after 1000 pool cycles.";
      const counterfactual = deriveCounterfactualRequirement("Memory leak", "Drain pool", explicit);
      expect(counterfactual).toBe(explicit);
    });
  });

  describe("normalizeCriticFinding", () => {
    test("normalizes raw critic finding object into strongly typed CriticFindingDetail", () => {
      const raw = {
        id: "F-AUTH-01",
        requirement_id: "REQ-AUTH",
        severity: "critical",
        observation: "JWT token validation allows expired tokens",
        remediation: "Verify exp claim strictly",
        revalidation: "bun test tests/unit/auth.test.ts",
        file_paths: ["src/auth/jwt.ts"],
      };

      const normalized = normalizeCriticFinding(raw);
      expect(normalized).not.toBeNull();
      expect(normalized?.id).toBe("F-AUTH-01");
      expect(normalized?.requirement_id).toBe("REQ-AUTH");
      expect(normalized?.severity).toBe("critical");
      expect(normalized?.counterfactualRequirement).toContain("Counterfactual Requirement:");
      expect(normalized?.revalidation).toBe("bun test tests/unit/auth.test.ts");
      expect(normalized?.affectedFilePaths).toEqual(["src/auth/jwt.ts"]);
      expect(normalized?.status).toBe("open");
    });

    test("normalizes raw critic finding object with affected_files and evidence array", () => {
      const raw = {
        id: "F-AUTH-02",
        requirement_id: "REQ-AUTH",
        severity: "minor",
        observation: "Missing audit log",
        remediation: "Add audit log call",
        affected_files: ["src/auth/audit.ts"],
        evidence: [{ kind: "log", snippet: "missing" }],
      };

      const normalized = normalizeCriticFinding(raw);
      expect(normalized).not.toBeNull();
      expect(normalized?.affectedFilePaths).toEqual(["src/auth/audit.ts"]);
      expect(normalized?.evidence.length).toBe(1);
    });

    test("returns null on invalid input", () => {
      expect(normalizeCriticFinding(null)).toBeNull();
      expect(normalizeCriticFinding("not-an-object")).toBeNull();
      expect(normalizeCriticFinding({})).toBeNull();
    });
  });

  describe("selectImplementerValidatorPair", () => {
    const dummyTask: TaskRecord = {
      id: "task-db",
      status: "running",
      original_implementer: "worker-alpha",
      repair_assignee: "worker-alpha",
      requirement_ids: ["REQ-DB"],
      write_scope: ["src/db.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    test("selects same author for initial round under same_author policy", () => {
      const pair = selectImplementerValidatorPair(dummyTask, 1, "same_author");
      expect(pair.implementerId).toBe("worker-alpha");
      expect(pair.isReplacementPair).toBeFalse();
      expect(pair.validatorId).not.toBe("worker-alpha");
    });

    test("throws HarnessError on invalid currentRound < 1", () => {
      expect(() => selectImplementerValidatorPair(dummyTask, 0)).toThrow(
        /currentRound must be positive/,
      );
    });

    test("falls back to first available implementer / validator when pool has no other match", () => {
      const pair = selectImplementerValidatorPair(
        dummyTask,
        2,
        "replacement_pair",
        ["worker-alpha"],
        ["worker-alpha"],
      );
      expect(pair.isReplacementPair).toBeTrue();
      expect(pair.implementerId).toBe("worker-alpha");
    });
  });

  describe("detectDeterministicRepeat", () => {
    test("detects identical repeat findings across rounds", () => {
      const priorFindings = [
        {
          id: "F-01",
          requirement_id: "R-1",
          severity: "critical" as const,
          observation: "Race condition in queue drain",
          evidence: [],
          remediation: "Add lock",
          revalidation: "bun test",
          status: "open" as const,
        },
      ];

      const newFinding: CriticFindingDetail = {
        id: "F-01",
        requirement_id: "R-1",
        severity: "critical",
        observation: "Race condition in queue drain",
        counterfactualRequirement: "Lock must be held",
        evidence: [],
        remediation: "Add lock",
        revalidation: "bun test",
        status: "open",
        affectedFilePaths: [],
      };

      expect(detectDeterministicRepeat(priorFindings, newFinding)).toBeTrue();
    });

    test("returns false when finding is novel or materially different", () => {
      const priorFindings = [
        {
          id: "F-01",
          requirement_id: "R-1",
          severity: "critical" as const,
          observation: "Race condition in queue drain",
          evidence: [],
          remediation: "Add lock",
          revalidation: "bun test",
          status: "open" as const,
        },
      ];

      const novelFinding: CriticFindingDetail = {
        id: "F-02",
        requirement_id: "R-1",
        severity: "minor",
        observation: "Log format missing correlation id",
        counterfactualRequirement: "Log correlation id",
        evidence: [],
        remediation: "Add trace header",
        revalidation: "bun test",
        status: "open",
        affectedFilePaths: [],
      };

      expect(detectDeterministicRepeat(priorFindings, novelFinding)).toBeFalse();
    });
  });
});
