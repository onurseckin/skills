import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as queueMod from "../../../olt/scripts/src/task/queue/index.ts";
import * as feedbackMod from "../../../olt/scripts/src/mind/feedback/index.ts";
import * as evolutionMod from "../../../olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts";
import {
  synthesizeAutonomousTasks,
  processAutonomousDualIntake,
  runAutonomousDualIntakeCycle,
  expandExternalPromptToPlan,
  planEnhance,
} from "../../../olt/scripts/src/mind/tasks/smart/executor/synthesis.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/index.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/index.ts";

describe("Smart Executor Synthesis Module", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const makeMockPlan = (id = "t1"): SmartTaskPlan => ({
    id,
    label: `Plan ${id}`,
    write_scope: [`src/${id}.ts`],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["pass"],
    dependencies: [],
    source_type: "direct_prompt",
    priority: "HIGH",
    rationale: "Rationale",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "imp",
    assigned_validator: "val",
  });

  const makeFeedback = (overrides: Partial<FeedbackItem> = {}): FeedbackItem => ({
    id: "fb-101",
    title: "Fix crash in router",
    content: "Router crashes on undefined path",
    category: "DEFECT",
    priority: "CRITICAL_USER_FEEDBACK",
    status: "PENDING",
    created_at: new Date().toISOString(),
    ...overrides,
  });

  describe("synthesizeAutonomousTasks", () => {
    it("delegates to feedback queue synthesis when pending feedback exists", () => {
      spies.push(
        spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([
          makeFeedback({ status: "PENDING" }),
        ]),
      );
      let calledFeedbackSynth = false;
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromFeedbackQueue").mockImplementation(() => {
          calledFeedbackSynth = true;
          return {
            tasks: [makeMockPlan("fb-task")],
            summary: "fb synth",
            source_type: "feedback_queue",
          };
        }),
      );

      const result = synthesizeAutonomousTasks({ maxTasks: 5 });
      expect(calledFeedbackSynth).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.id).toBe("fb-task");
    });

    it("delegates to self-evolution synthesis when no pending feedback exists", () => {
      spies.push(
        spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([
          makeFeedback({ status: "PROCESSED" }),
        ]),
      );
      let calledSelfEvo = false;
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromSelfEvolution").mockImplementation(() => {
          calledSelfEvo = true;
          return {
            tasks: [makeMockPlan("evo-task")],
            summary: "evo synth",
            source_type: "self_evolution",
          };
        }),
      );

      const result = synthesizeAutonomousTasks();
      expect(calledSelfEvo).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.id).toBe("evo-task");
    });
  });

  describe("processAutonomousDualIntake & runAutonomousDualIntakeCycle", () => {
    it("handles Mode B: pending feedback ingestion regardless of queue active state", () => {
      const activeQueueItem: TaskQueueItem = {
        id: "q-act",
        label: "Active",
        category: "CORE_ENGINE",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        dependencies: [],
        status: "IN_PROGRESS",
        priority: "NORMAL",
        created_at: "",
      };
      const synthQueueItem: TaskQueueItem = {
        id: "q-fb",
        label: "FB",
        category: "CORE_ENGINE",
        write_scope: ["src/fb.ts"],
        gate: "bun test",
        dependencies: [],
        status: "PENDING",
        priority: "HIGH",
        created_at: "",
      };

      spies.push(
        spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([
          makeFeedback({ id: "fb-1", status: "PENDING" }),
        ]),
      );
      spies.push(
        spyOn(queueMod, "readTaskQueue").mockImplementation(() => [
          activeQueueItem,
          synthQueueItem,
        ]),
      );
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromFeedbackQueue").mockReturnValue({
          tasks: [makeMockPlan("task-fb-1")],
          summary: "synth fb",
          source_type: "feedback_queue",
        }),
      );

      const result = processAutonomousDualIntake();
      expect(result.mode).toBe("Mode_B_External_Intake");
      expect(result.synthesized_plans).toHaveLength(1);
      expect(result.admitted_feedback_ids).toEqual(["fb-1"]);
      expect(result.summary).toContain("Mode B External Intake");
    });

    it("handles Mode A and Queue_Active modes", () => {
      const qDone: TaskQueueItem = {
        id: "q-d",
        label: "D",
        category: "CORE_ENGINE",
        write_scope: ["a.ts"],
        gate: "bun test",
        dependencies: [],
        status: "COMPLETED",
        priority: "NORMAL",
        created_at: "",
      };
      const qBlock: TaskQueueItem = {
        id: "q-b",
        label: "B",
        category: "CORE_ENGINE",
        write_scope: ["b.ts"],
        gate: "bun test",
        dependencies: [],
        status: "BLOCKED",
        priority: "HIGH",
        created_at: "",
      };
      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([]));
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue([qDone]));
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromSelfEvolution").mockReturnValue({
          tasks: [makeMockPlan("t-evo")],
          summary: "synth",
          source_type: "self_evolution",
        }),
      );

      const resEvo = runAutonomousDualIntakeCycle();
      expect(resEvo.mode).toBe("Mode_A_Self_Evolution");
      expect(resEvo.synthesized_plans).toHaveLength(1);

      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue([qBlock]));
      const resBlock = processAutonomousDualIntake();
      expect(resBlock.mode).toBe("Queue_Active");
    });
  });

  describe("expandExternalPromptToPlan & planEnhance", () => {
    it("handles prompt expansion and plan enhancement from feedback", () => {
      expect(() => expandExternalPromptToPlan("   ")).toThrow(HarnessError);
      const planDefault = expandExternalPromptToPlan("Implement parser edge case");
      expect(planDefault.label).toBe("Implement parser edge case");
      expect(planDefault.source_type).toBe("direct_prompt");

      const prompt = "Refactor Database Cache\nDetails";
      const planCustom = expandExternalPromptToPlan(prompt, {
        baseId: "custom-db",
        charterGoals: ["G1"],
        priority: "CRITICAL",
        writeScope: ["src/db.ts"],
        gate: "bun test",
        assignedTier: "Tier_1_Orchestrator",
        assignedImplementer: "imp-1",
        assignedValidator: "val-1",
      });
      expect(planCustom.id).toBe("custom-db");
      expect(planCustom.priority).toBe("CRITICAL");

      const planStr = planEnhance("Enhance audit", { priority: "NORMAL" });
      expect(planStr.label).toBe("Enhance audit");

      const fb = makeFeedback({
        id: "fb-1",
        title: "Optimize JSON",
        category: "PERFORMANCE",
        priority: "CRITICAL_USER_FEEDBACK",
      });
      const planFb = planEnhance(fb, {
        baseId: "task-fb-1",
        charterGoals: ["G1"],
        priority: "HIGH",
      });
      expect(planFb.id).toBe("task-fb-1");
      expect(planFb.source_type).toBe("plan_enhancement");
    });
  });
});
