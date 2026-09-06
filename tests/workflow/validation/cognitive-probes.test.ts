import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  COGNITIVE_VECTORS,
  assertCognitiveProbes,
  assertTaskReviewCognitiveProbes,
  assertValidateFinishProbes,
  isCognitiveVector,
  isProbeVerified,
  normalizeVector,
  validateCognitiveProbes,
  type CognitiveProbe,
} from "../../../olt/scripts/src/workflow/validation/index.ts";

function createMockProbe(
  id: string,
  vector: string,
  resolutionMethod: string = "counterfactual_unit_test",
  verified: boolean = true,
): CognitiveProbe {
  return {
    id,
    vector,
    description: `Probe verification for ${vector} failure mode`,
    resolution_method: resolutionMethod,
    verified,
    status: "verified",
  };
}

describe("DEFECT-VALIDATION-PUSH-BYPASS: Cognitive Validation Pushback & Adversarial Enforcement Gate", () => {
  describe("Rejection when < 5 distinct cognitive pushback probes exist (INVALID_STATE)", () => {
    it("rejects when task.validations is missing or empty with INVALID_STATE", () => {
      const taskEmpty = { id: "task-test-01", validations: [] };
      expect(() => assertCognitiveProbes(taskEmpty)).toThrow(HarnessError);
      try {
        assertCognitiveProbes(taskEmpty);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("Single-pass superficial approval rejected");
      }
    });

    it("rejects when task.validations is missing with INVALID_STATE", () => {
      const taskNoValidations = { id: "task-test-02" };
      expect(() => assertCognitiveProbes(taskNoValidations)).toThrow(HarnessError);
      try {
        assertCognitiveProbes(taskNoValidations);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("Single-pass superficial approval rejected");
      }
    });

    it("rejects when only 1 cognitive probe exists with INVALID_STATE", () => {
      const task = {
        id: "task-test-03",
        validations: [createMockProbe("p-1", "EMPTY_PAYLOAD")],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("found 1 distinct probe(s), but minimum 5 are required");
      }
    });

    it("rejects when 4 cognitive probes exist with INVALID_STATE", () => {
      const task = {
        id: "task-test-04",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "TIMEOUT_STAGNATION"),
          createMockProbe("p-3", "CONCURRENCY_MUTATION"),
          createMockProbe("p-4", "HOST_BOUNDARY"),
        ],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("found 4 distinct probe(s), but minimum 5 are required");
      }
    });

    it("rejects duplicate probes when fewer than 5 distinct probes exist", () => {
      const task = {
        id: "task-test-05",
        validations: [
          createMockProbe("dup-1", "EMPTY_PAYLOAD"),
          createMockProbe("dup-1", "EMPTY_PAYLOAD"),
          createMockProbe("dup-1", "EMPTY_PAYLOAD"),
          createMockProbe("dup-2", "TIMEOUT_STAGNATION"),
          createMockProbe("dup-2", "TIMEOUT_STAGNATION"),
        ],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("found 2 distinct probe(s), but minimum 5 are required");
      }
    });

    it("assertTaskReviewCognitiveProbes and assertValidateFinishProbes reject superficial approval", () => {
      const task = { id: "task-test-06", validations: [] };
      expect(() => assertTaskReviewCognitiveProbes(task, "pass")).toThrow(HarnessError);
      expect(() => assertValidateFinishProbes(task)).toThrow(HarnessError);
      expect(() => assertTaskReviewCognitiveProbes(task, "reject")).not.toThrow();
    });
  });

  describe("Acceptance when >= 5 distinct cognitive probes with verified resolution methods exist", () => {
    it("accepts exactly 5 distinct cognitive probes across multiple vectors", () => {
      const task = {
        id: "task-test-07",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "TIMEOUT_STAGNATION"),
          createMockProbe("p-3", "CONCURRENCY_MUTATION"),
          createMockProbe("p-4", "HOST_BOUNDARY"),
          createMockProbe("p-5", "STATE_TRANSITION"),
        ],
      };
      expect(() => assertCognitiveProbes(task)).not.toThrow();
      expect(() => assertTaskReviewCognitiveProbes(task, "pass")).not.toThrow();
      expect(() => assertValidateFinishProbes(task)).not.toThrow();

      const result = validateCognitiveProbes(task);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.distinctProbes).toHaveLength(5);
      expect(result.verifiedProbes).toHaveLength(5);
      expect(result.distinctVectors).toHaveLength(5);
    });

    it("accepts more than 5 distinct verified probes", () => {
      const task = {
        id: "task-test-08",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "TIMEOUT_STAGNATION"),
          createMockProbe("p-3", "CONCURRENCY_MUTATION"),
          createMockProbe("p-4", "HOST_BOUNDARY"),
          createMockProbe("p-5", "STATE_TRANSITION"),
          createMockProbe("p-6", "TYPE_INVARIANT"),
          createMockProbe("p-7", "CLI_TELEMETRY"),
        ],
      };
      const result = validateCognitiveProbes(task);
      expect(result.valid).toBe(true);
      expect(result.distinctProbes).toHaveLength(7);
      expect(result.verifiedProbes).toHaveLength(7);
      expect(result.distinctVectors).toHaveLength(7);
    });

    it("accepts nested probes inside validation attempts", () => {
      const task = {
        id: "task-test-09",
        validations: [
          {
            validator_id: "val-1",
            domain: "code-quality",
            attempt: 1,
            probes: [
              createMockProbe("np-1", "EMPTY_PAYLOAD"),
              createMockProbe("np-2", "TIMEOUT_STAGNATION"),
              createMockProbe("np-3", "CONCURRENCY_MUTATION"),
            ],
          },
          {
            validator_id: "val-2",
            domain: "code-quality",
            attempt: 2,
            probes: [
              createMockProbe("np-4", "HOST_BOUNDARY"),
              createMockProbe("np-5", "STATE_TRANSITION"),
            ],
          },
        ],
      };
      expect(() => assertCognitiveProbes(task)).not.toThrow();
    });
  });

  describe("Verification across multiple vectors", () => {
    it("rejects when all 5 probes are confined to a single vector with INVALID_STATE", () => {
      const task = {
        id: "task-test-10",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "EMPTY_PAYLOAD"),
          createMockProbe("p-3", "EMPTY_PAYLOAD"),
          createMockProbe("p-4", "EMPTY_PAYLOAD"),
          createMockProbe("p-5", "EMPTY_PAYLOAD"),
        ],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("Insufficient cognitive vector diversity");
        expect(error.message).toContain("probes span 1 distinct vector(s)");
      }
    });

    it("accepts when 5 probes span multiple distinct vectors (e.g. 2 vectors)", () => {
      const task = {
        id: "task-test-11",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "EMPTY_PAYLOAD"),
          createMockProbe("p-3", "EMPTY_PAYLOAD"),
          createMockProbe("p-4", "TIMEOUT_STAGNATION"),
          createMockProbe("p-5", "TIMEOUT_STAGNATION"),
        ],
      };
      expect(() => assertCognitiveProbes(task)).not.toThrow();
    });

    it("validates canonical cognitive vectors recognition and normalization", () => {
      expect(COGNITIVE_VECTORS).toContain("EMPTY_PAYLOAD");
      expect(COGNITIVE_VECTORS).toContain("ADVERSARIAL_GATE");
      expect(isCognitiveVector("EMPTY_PAYLOAD")).toBe(true);
      expect(isCognitiveVector("empty_payload")).toBe(true);
      expect(isCognitiveVector("empty-payload")).toBe(true);
      expect(isCognitiveVector("NON_EXISTENT_VECTOR")).toBe(false);
      expect(normalizeVector("timeout stagnation")).toBe("TIMEOUT_STAGNATION");
    });
  });

  describe("Verified resolution methods enforcement", () => {
    it("rejects when a probe lacks a resolution method with INVALID_STATE", () => {
      const task = {
        id: "task-test-12",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "TIMEOUT_STAGNATION"),
          createMockProbe("p-3", "CONCURRENCY_MUTATION"),
          createMockProbe("p-4", "HOST_BOUNDARY"),
          { id: "p-5", vector: "STATE_TRANSITION", description: "No resolution", verified: true },
        ],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("lack verified resolution methods: [p-5]");
      }
    });

    it("rejects when a probe has verified: false with INVALID_STATE", () => {
      const task = {
        id: "task-test-13",
        validations: [
          createMockProbe("p-1", "EMPTY_PAYLOAD"),
          createMockProbe("p-2", "TIMEOUT_STAGNATION"),
          createMockProbe("p-3", "CONCURRENCY_MUTATION"),
          createMockProbe("p-4", "HOST_BOUNDARY"),
          createMockProbe("p-5", "STATE_TRANSITION", "unit_test", false),
        ],
      };
      try {
        assertCognitiveProbes(task);
        expect(true).toBe(false);
      } catch (err) {
        const error = err as HarnessError;
        expect(error.code).toBe("INVALID_STATE");
        expect(error.message).toContain("lack verified resolution methods: [p-5]");
      }
    });

    it("isProbeVerified helper correctly evaluates probe verification state", () => {
      expect(isProbeVerified(createMockProbe("p-1", "EMPTY_PAYLOAD"))).toBe(true);
      expect(isProbeVerified({ vector: "EMPTY_PAYLOAD" })).toBe(false);
      expect(isProbeVerified({ vector: "EMPTY_PAYLOAD", resolution_method: "" })).toBe(false);
      expect(
        isProbeVerified({ vector: "EMPTY_PAYLOAD", resolution_method: "test", verified: false }),
      ).toBe(false);
      expect(
        isProbeVerified({ vector: "EMPTY_PAYLOAD", resolution_method: "test", status: "open" }),
      ).toBe(false);
    });
  });
});
