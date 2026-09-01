import { describe, expect, it, test } from "bun:test";
import {
  categorizeDefect,
  computeDefectDiscriminator,
  createDefectContentHash,
  createFnv1aHash,
  createSha256Hash,
  normalizeObservationSignature,
} from "../../../olt/scripts/src/mind/defects/index.ts";
import type {
  DefectCategory,
  DefectEntry,
  DefectRecordInput,
} from "../../../olt/scripts/src/mind/defects/core/index.ts";

export const discriminatorSuiteName = "Defect Discriminator, Normalization & Categorization";

describe(discriminatorSuiteName, () => {
  describe("categorizeDefect", () => {
    it("categorizes boundary violations correctly", () => {
      const cases: Array<{ input: Partial<DefectRecordInput>; expected: DefectCategory }> = [
        {
          input: {
            type: "role_confusion_detected",
            observation: "Agent attempted orchestrator actions",
          },
          expected: "boundary_violation",
        },
        {
          input: { type: "role_leak", observation: "Main thread direct execution detected" },
          expected: "boundary_violation",
        },
        {
          input: {
            type: "unauthorized_mutation",
            observation: "Direct file edit in unauthorized write scope",
          },
          expected: "boundary_violation",
        },
        {
          input: {
            type: "role_amnesia",
            observation: "Agent forgot its tier boundaries and executed human shell commands",
          },
          expected: "boundary_violation",
        },
      ];

      for (const c of cases) {
        expect(categorizeDefect(c.input as DefectEntry)).toBe(c.expected);
      }
    });

    it("categorizes model reasoning errors correctly", () => {
      const cases: Array<{ input: Partial<DefectRecordInput>; expected: DefectCategory }> = [
        {
          input: {
            type: "hallucination_error",
            observation: "Agent hallucinated non-existent module import",
          },
          expected: "model_reasoning_error",
        },
        {
          input: {
            type: "plan_drift",
            observation: "Intent drift and instruction drift detected during execution",
          },
          expected: "model_reasoning_error",
        },
        {
          input: {
            type: "revision_paralysis",
            observation:
              "Self-critique loop resulted in plan revision paralysis and passive inertia",
          },
          expected: "model_reasoning_error",
        },
        {
          input: {
            type: "idle_death",
            observation: "Agent fell into sleep loop and self-termination failure",
          },
          expected: "model_reasoning_error",
        },
      ];

      for (const c of cases) {
        expect(categorizeDefect(c.input as DefectEntry)).toBe(c.expected);
      }
    });

    it("categorizes code defects correctly", () => {
      const cases: Array<{ input: Partial<DefectRecordInput>; expected: DefectCategory }> = [
        {
          input: { type: "syntax_error", observation: "Unexpected token in parser" },
          expected: "code_defect",
        },
        {
          input: { type: "type_mismatch", observation: "Type number is not assignable to string" },
          expected: "code_defect",
        },
        {
          input: { type: "gate_failure", observation: "bun test failed with 2 failing tests" },
          expected: "code_defect",
        },
        {
          input: {
            type: "unhandled_rejection",
            observation: "Unhandled promise rejection in store",
          },
          expected: "code_defect",
        },
      ];

      for (const c of cases) {
        expect(categorizeDefect(c.input as DefectEntry)).toBe(c.expected);
      }
    });
  });

  describe("normalizeObservationSignature", () => {
    test("strips volatile tokens and normalizes signatures", () => {
      const raw =
        "Error on 2026-08-22T12:00:00.000Z at 0x7fff5fbff8a0 with pid=12345 line: 42 in /Users/foo/.capsules/run-abc/state.json defect-123-abc456";
      const normalized = normalizeObservationSignature(raw);
      expect(normalized).toContain("<time>");
      expect(normalized).toContain("<addr>");
      expect(normalized).toContain("pid=<pid>");
      expect(normalized).toContain("line=<num>");
      expect(normalized).toContain("<capsule_path>");
      expect(normalized).toContain("defect-<id>");
      expect(normalized).not.toContain("12345");
    });

    test("handles empty and non-string inputs safely", () => {
      expect(normalizeObservationSignature("")).toBe("");
      expect(normalizeObservationSignature("   \n\t  ")).toBe("");
    });
  });

  describe("content hashing", () => {
    test("computes deterministic FNV-1a and SHA-256 content hashes", () => {
      const fnv = createFnv1aHash("test-payload-sample");
      expect(fnv).toHaveLength(8);
      expect(createFnv1aHash("test-payload-sample")).toBe(fnv);

      const sha = createSha256Hash("test-payload-sample");
      expect(sha).toHaveLength(64);
      expect(createSha256Hash("test-payload-sample")).toBe(sha);

      const defect: DefectRecordInput = {
        type: "syntax_error",
        category: "code_defect",
        observation: "Syntax error on line 12",
        agent_id: "agent-1",
      };

      const hashSha = createDefectContentHash(defect, "sha256");
      const hashFnv = createDefectContentHash(defect, "fnv1a");
      expect(hashSha).toHaveLength(64);
      expect(hashFnv).toHaveLength(8);
    });
  });

  describe("computeDefectDiscriminator", () => {
    test("returns explicit dedup_key if provided", () => {
      const defect: DefectRecordInput = {
        type: "role_confinement_violation",
        dedup_key: "custom::explicit::key::123",
      };
      expect(computeDefectDiscriminator(defect)).toBe("custom::explicit::key::123");
    });

    test("derives canonical discriminator from category, type, agent, and normalized signature", () => {
      const b1: DefectRecordInput = {
        type: "main_thread_direct_execution",
        category: "boundary_violation",
        agent_id: "agent-orch-01",
        observation: "Direct execution at 2026-08-22T10:00:00.000Z by pid=9999",
      };

      const b2: DefectRecordInput = {
        type: "main_thread_direct_execution",
        category: "boundary_violation",
        agent_id: "agent-orch-01",
        observation: "Direct execution at 2026-08-22T10:05:00.000Z by pid=1111",
      };

      const key1 = computeDefectDiscriminator(b1);
      const key2 = computeDefectDiscriminator(b2);

      expect(key1).toBe(
        "boundary_violation::main_thread_direct_execution::agent-orch-01::direct execution at <time> by pid=<pid>",
      );
      expect(key1).toBe(key2);
    });

    test("supports custom discriminator callback", () => {
      const defect: DefectRecordInput = {
        type: "syntax_error",
        observation: "Missing semicolon",
      };
      const key = computeDefectDiscriminator(defect, {
        customDiscriminator: (b) => `custom::${b.type}`,
      });
      expect(key).toBe("custom::syntax_error");
    });

    test("supports disabling agent ID or category in discriminator", () => {
      const b1: DefectRecordInput = {
        type: "syntax_error",
        category: "code_defect",
        agent_id: "agent-1",
        observation: "Unused variable",
      };
      const b2: DefectRecordInput = {
        type: "syntax_error",
        category: "code_defect",
        agent_id: "agent-2",
        observation: "Unused variable",
      };

      const key1 = computeDefectDiscriminator(b1, { includeAgentId: false });
      const key2 = computeDefectDiscriminator(b2, { includeAgentId: false });
      expect(key1).toBe(key2);
    });
  });
});
