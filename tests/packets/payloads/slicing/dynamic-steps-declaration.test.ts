import { describe, test, expect } from "bun:test";
import {
  extractAcceptanceCriteria,
  generateDynamicValidationSteps,
  renderDynamicValidationSteps,
  formatDynamicValidationChecklist,
  computeDynamicStepCount,
  validateCognitiveStepCoverage,
  buildDynamicStepsFromWorkflowState,
  buildDynamicStepsFromPacketInput,
} from "../../../../olt/scripts/src/packets/dynamic-steps.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import type { PacketInput } from "../../../../olt/scripts/src/packets/types.ts";


describe("dynamic-steps criteria & generation", () => {
  describe("extractAcceptanceCriteria", () => {
    test("handles non-array or undefined requirements with targetSet", () => {
      const crit = extractAcceptanceCriteria(undefined, ["req-1", "req-2"]);
      expect(crit).toHaveLength(2);
      expect(crit[0].requirementId).toBe("req-1");
      expect(crit[0].criterionId).toBe("crit-req-1-1");
      expect(crit[0].evidenceRequirements).toEqual(["Gate execution output for req-1"]);
    });

    test("handles non-array or undefined requirements without targetSet", () => {
      expect(extractAcceptanceCriteria(undefined)).toEqual([]);
      expect(extractAcceptanceCriteria(null as unknown as readonly unknown[])).toEqual([]);
    });

    test("extracts acceptance criteria from structured requirement objects with acceptance lists", () => {
      const requirements = [
        {
          id: "req-auth",
          acceptance: [
            {
              id: "crit-auth-1",
              criterion: "Token must be validated",
              evidence: ["Auth log snippet"],
            },
            {
              statement: "Fallback statement check",
              evidence: [],
            },
            {
              // neither criterion nor statement
            },
          ],
        },
        {
          id: "req-no-acc",
          instruction: "Instruction text",
          evidence: ["Proof A"],
        },
        {
          id: "req-impl",
          implementation: "Impl text",
        },
        {
          // missing id, missing acceptance, missing instruction/impl
        },
        "not an object",
      ];

      const res = extractAcceptanceCriteria(requirements);
      expect(res.length).toBe(6);
      expect(res[0].criterionId).toBe("crit-auth-1");
      expect(res[0].criterion).toBe("Token must be validated");
      expect(res[0].evidenceRequirements).toEqual(["Auth log snippet"]);

      expect(res[1].criterionId).toBe("crit-req-auth-2");
      expect(res[1].criterion).toBe("Fallback statement check");
      expect(res[1].evidenceRequirements).toEqual(["Gate execution output for req-auth"]);

      expect(res[2].criterionId).toBe("crit-req-auth-3");
      expect(res[2].criterion).toBe("Verify acceptance condition 3 for req-auth");

      expect(res[3].requirementId).toBe("req-no-acc");
      expect(res[3].criterion).toBe("Instruction text");
      expect(res[3].evidenceRequirements).toEqual(["Proof A"]);

      expect(res[4].requirementId).toBe("req-impl");
      expect(res[4].criterion).toBe("Impl text");
      expect(res[4].evidenceRequirements).toEqual(["Gate execution output for req-impl"]);

      expect(res[5].requirementId).toBe("req-unknown");
      expect(res[5].criterion).toBe("Verify requirement req-unknown");
    });

    test("filters by targetRequirementIds and appends missing targets", () => {
      const requirements = [
        {
          id: "req-1",
          acceptance: [{ criterion: "Check 1" }],
        },
        {
          id: "req-2",
          acceptance: [{ criterion: "Check 2" }],
        },
      ];

      const res = extractAcceptanceCriteria(requirements, ["req-1", "req-3"]);
      expect(res).toHaveLength(2);
      expect(res[0].requirementId).toBe("req-1");
      expect(res[1].requirementId).toBe("req-3");
      expect(res[1].criterionId).toBe("crit-req-3-1");
    });
  });

  describe("categorizeCriterion and generateDynamicValidationSteps", () => {
    test("categorizes different criterion keywords correctly", () => {
      const requirements = [
        { id: "req-falsify", acceptance: [{ criterion: "Ensure counterfactual falsifiability" }] },
        {
          id: "req-boundary",
          acceptance: [{ criterion: "Verify write_scope boundary confinement" }],
        },
        {
          id: "req-evidence",
          acceptance: [{ criterion: "Verify artifact proof and digest schema" }],
        },
        {
          id: "req-invariant",
          acceptance: [{ criterion: "Ensure zero any and typing invariant contract" }],
        },
        { id: "req-generic", acceptance: [{ criterion: "Standard functionality behavior" }] },
      ];

      const plan = generateDynamicValidationSteps({
        requirements,
      });

      expect(plan.totalSteps).toBe(5);
      expect(plan.steps[0].category).toBe("falsifiability_check");
      expect(plan.steps[1].category).toBe("boundary_verification");
      expect(plan.steps[2].category).toBe("evidence_audit");
      expect(plan.steps[3].category).toBe("domain_invariant");
      expect(plan.steps[4].category).toBe("criterion_verification");
      expect(plan.mappedRequirementIds).toHaveLength(5);
      expect(plan.summary).toContain(
        "5 explicit cognitive steps generated for 5 mapped requirements",
      );
    });

    test("generates default step if criteria list is empty", () => {
      const plan = generateDynamicValidationSteps({
        task: {
          id: "task-123",
          label: "Custom Feature",
          requirement_ids: [],
        } as unknown as TaskRecord,
        requirements: [],
      });

      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].requirementId).toBe("task-123-req");
      expect(plan.steps[0].criterion).toContain("Verify Custom Feature satisfies task contract");
      expect(plan.summary).toContain(
        "1 explicit cognitive step generated for 1 mapped requirement (1 total acceptance criteria).",
      );
    });

    test("extracts targetRequirementIds from task with string array requirement_ids", () => {
      const plan = generateDynamicValidationSteps({
        task: {
          id: "task-456",
          requirement_ids: ["req-a", "req-b", 123 as unknown as string],
        } as unknown as TaskRecord,
        requirements: [{ id: "req-a", acceptance: [{ criterion: "A done" }] }],
      });

      expect(plan.totalSteps).toBe(2);
      expect(plan.steps.map((s) => s.requirementId)).toEqual(["req-a", "req-b"]);

      const planWithoutReqs = generateDynamicValidationSteps({
        task: {
          id: "task-no-reqs",
        } as unknown as TaskRecord,
        requirements: [],
      });
      expect(planWithoutReqs.totalSteps).toBe(1);

      const planNullTask = generateDynamicValidationSteps({
        task: null,
        requirements: [],
      });
      expect(planNullTask.totalSteps).toBe(1);
    });
  });

});
