import { describe, test, expect } from "bun:test";
import {
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

describe("dynamic-steps execution & rendering", () => {
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
      const reqs = [{ id: "r1", acceptance: [{ criterion: "c1" }, { criterion: "c2" }] }];
      expect(computeDynamicStepCount(reqs)).toBe(2);
      expect(computeDynamicStepCount(reqs, ["r1", "r2"])).toBe(3);
    });
  });

  describe("validateCognitiveStepCoverage", () => {
    test("validates complete step coverage with string checks", () => {
      const plan = generateDynamicValidationSteps({
        requirements: [
          { id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] },
          {
            id: "req-2",
            acceptance: [{ id: "crit-2", criterion: "C2", evidence: ["proof.json"] }],
          },
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
        requirements: [{ id: "req-1", acceptance: [{ id: "crit-1", criterion: "C1" }] }],
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
