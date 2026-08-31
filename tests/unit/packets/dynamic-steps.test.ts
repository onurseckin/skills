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
} from "../../../olt/scripts/src/packets/dynamic-steps.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import type { PacketInput } from "../../../olt/scripts/src/packets/types.ts";

describe("dynamic-steps", () => {
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
        { id: "req-boundary", acceptance: [{ criterion: "Verify write_scope boundary confinement" }] },
        { id: "req-evidence", acceptance: [{ criterion: "Verify artifact proof and digest schema" }] },
        { id: "req-invariant", acceptance: [{ criterion: "Ensure zero any and typing invariant contract" }] },
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
      expect(plan.summary).toContain("5 explicit cognitive steps generated for 5 mapped requirements");
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
      expect(plan.summary).toContain("1 explicit cognitive step generated for 1 mapped requirement (1 total acceptance criteria).");
    });

    test("extracts targetRequirementIds from task with string array requirement_ids", () => {
      const plan = generateDynamicValidationSteps({
        task: {
          id: "task-456",
          requirement_ids: ["req-a", "req-b", 123 as unknown as string],
        } as unknown as TaskRecord,
        requirements: [
          { id: "req-a", acceptance: [{ criterion: "A done" }] },
        ],
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

  describe("renderDynamicValidationSteps & formatDynamicValidationChecklist", () => {
    test("renders empty step list markdown", () => {
      const md = renderDynamicValidationSteps([]);
      expect(md).toContain("No cognitive validation steps generated.");
    });

    test("renders populated step list markdown and checklist", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          {
            id: "req-1",
            acceptance: [
              { id: "crit-1", criterion: "Do thing", evidence: ["log.txt"] },
              { id: "crit-2", criterion: "Do other", evidence: [] },
            ],
          },
        ],
      });

      const md = renderDynamicValidationSteps(plan.steps);
      expect(md).toContain("### Dynamic Cognitive Validation Steps (2 Steps)");
      expect(md).toContain("`log.txt`");

      const customStep = {
        ...plan.steps[0],
        evidenceRequirements: [],
      };
      const mdWithNone = renderDynamicValidationSteps([customStep]);
      expect(mdWithNone).toContain("None declared");

      const checklist = formatDynamicValidationChecklist(plan.steps);
      expect(checklist).toContain("- [ ] Step 1/2: [`crit-1`] Do thing (Requirement: `req-1`)");
      expect(checklist).toContain("- [ ] Step 2/2: [`crit-2`] Do other (Requirement: `req-1`)");
    });
  });

  describe("computeDynamicStepCount", () => {
    test("computes step count directly from requirements", () => {
      const reqs = [
        { id: "r1", acceptance: [{ criterion: "c1" }, { criterion: "c2" }] },
      ];
      expect(computeDynamicStepCount(reqs)).toBe(2);
      expect(computeDynamicStepCount(reqs, ["r1", "r2"])).toBe(3);
    });
  });

  describe("validateCognitiveStepCoverage", () => {
    test("validates complete step coverage with string checks", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          { id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] },
          { id: "req-2", acceptance: [{ id: "crit-2", criterion: "C2", evidence: ["proof.json"] }] },
        ],
      });

      const res = validateCognitiveStepCoverage(plan, ["crit-1", "proof.json"]);
      expect(res.covered).toBe(true);
      expect(res.missingStepsCount).toBe(0);
      expect(res.coveredStepsCount).toBe(2);
      expect(res.issues).toHaveLength(0);
    });

    test("validates step coverage with jsonObject checks", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          { id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] },
          { id: "req-2", acceptance: [{ id: "crit-2", criterion: "C2" }] },
          { id: "req-3", acceptance: [{ id: "crit-3", criterion: "C3" }] },
        ],
      });

      const res = validateCognitiveStepCoverage(plan, [
        { command_id: "crit-1" },
        { criterion_id: "crit-2" },
        { requirement_id: "req-3" },
      ]);
      expect(res.covered).toBe(true);
      expect(res.coveredStepsCount).toBe(3);
    });

    test("identifies missing checks and reports issues", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          { id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] },
          { id: "req-2", acceptance: [{ id: "crit-2", criterion: "C2" }] },
        ],
      });

      const res = validateCognitiveStepCoverage(plan, ["crit-1"]);
      expect(res.covered).toBe(false);
      expect(res.missingStepsCount).toBe(1);
      expect(res.coveredStepsCount).toBe(1);
      expect(res.issues[0].criterionId).toBe("crit-2");
      expect(res.issues[0].reason).toContain("crit-2");
    });

    test("when submittedChecks is empty or not passed, coveredCount equals total steps", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          { id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] },
        ],
      });

      const res = validateCognitiveStepCoverage(plan, []);
      expect(res.covered).toBe(true);
      expect(res.coveredStepsCount).toBe(1);
    });
  });

  describe("buildDynamicStepsFromWorkflowState & buildDynamicStepsFromPacketInput", () => {
    test("buildDynamicStepsFromWorkflowState with array and object requirements", () => {
      const state1 = {
        requirements: [{ id: "req-1", acceptance: [{ criterion: "A" }] }],
      } as unknown as WorkflowState;
      const task1 = { id: "t1", requirement_ids: ["req-1"] } as unknown as TaskRecord;

      const plan1 = buildDynamicStepsFromWorkflowState(state1, task1);
      expect(plan1.totalSteps).toBe(1);

      const state2 = {
        requirements: {
          requirements: [{ id: "req-2", acceptance: [{ criterion: "B" }] }, "invalid"],
        },
      } as unknown as WorkflowState;
      const task2 = { id: "t2", requirement_ids: ["req-2"] } as unknown as TaskRecord;

      const plan2 = buildDynamicStepsFromWorkflowState(state2, task2);
      expect(plan2.totalSteps).toBe(1);
    });

    test("buildDynamicStepsFromPacketInput with task and subTask", () => {
      const packetInput: PacketInput = {
        runId: "run-1",
        graphRevision: 1,
        role: "validator",
        agentId: "agent-1",
        task: {
          id: "t1",
          requirement_ids: ["req-1"],
        } as unknown as TaskRecord,
        state: {
          requirements: [{ id: "req-1", acceptance: [{ criterion: "Test" }] }],
        } as unknown as WorkflowState,
        commonInstructions: { bytes: new Uint8Array(), sha256: "abc" },
        authoritativeContext: {},
        evidenceSchema: {},
        targetedCommands: [],
        attempt: 1,
      };

      const plan = buildDynamicStepsFromPacketInput(packetInput);
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].requirementId).toBe("req-1");
    });
  });
});
