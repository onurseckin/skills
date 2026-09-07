import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as feedbackMod from "../../../olt/scripts/src/mind/feedback/index.ts";
import * as queueMod from "../../../olt/scripts/src/task/queue/index.ts";
import * as evolutionMod from "../../../olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts";
import {
  expandExternalPromptToPlan,
  planEnhance,
  processAutonomousDualIntake,
  runAutonomousDualIntakeCycle,
  synthesizeAutonomousTasks,
} from "../../../olt/scripts/src/mind/tasks/smart/executor/synthesis.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/index.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/index.ts";

describe("Mind Tasks: Task Expansion & Candidate Evaluation", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies) {
      try {
        spy.mockRestore();
      } catch {}
    }
    spies.length = 0;
  });

  const makeMockPlan = (id = "task-exp-1"): SmartTaskPlan => ({
    id,
    label: `Expansion Plan ${id}`,
    write_scope: [`src/mind/tasks/${id}.ts`],
    gate: "bun test",
    charter_goals: ["Zero Disk IO", "Sub-10ms SLA"],
    acceptance_criteria: ["VirtualMemoryFS verification"],
    dependencies: [],
    source_type: "direct_prompt",
    priority: "HIGH",
    rationale: "Autonomous candidate task expansion",
    assigned_tier: "Tier_3_Implementer",
    assigned_implementer: "implementer_mind_tasks_perf",
    assigned_validator: "validator_mind_tasks_perf",
  });

  const makeFeedback = (overrides: Partial<FeedbackItem> = {}): FeedbackItem => ({
    id: "fb-exp-101",
    title: "Enforce zero disk I/O in task tests",
    content: "Tests must strictly use VirtualMemoryFS or memory fixtures",
    category: "CORE_ENGINE",
    priority: "CRITICAL_USER_FEEDBACK",
    status: "PENDING",
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  const makeTask = (id: string, status = "RUNNING", priority = "HIGH"): TaskQueueItem => ({
    id,
    label: id,
    category: "CORE_ENGINE",
    write_scope: [`src/${id}.ts`],
    gate: "bun test",
    dependencies: [],
    status,
    priority,
    created_at: new Date().toISOString(),
  });

  describe("synthesizeAutonomousTasks", () => {
    it("synthesizes tasks from self-evolution when feedback queue is empty (Mode A)", () => {
      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([]));
      let calledSelfEvolution = false;
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromSelfEvolution").mockImplementation(() => {
          calledSelfEvolution = true;
          return {
            tasks: [makeMockPlan("evo-exp-task")],
            summary: "self-evolution synthesis",
            source_type: "self_evolution",
          };
        }),
      );

      const result = synthesizeAutonomousTasks({ maxTasks: 3 });
      expect(calledSelfEvolution).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.id).toBe("evo-exp-task");
    });

    it("synthesizes tasks from feedback queue when pending feedback exists (Mode B)", () => {
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
            tasks: [makeMockPlan("fb-exp-task")],
            summary: "feedback queue synthesis",
            source_type: "feedback_queue",
          };
        }),
      );

      const result = synthesizeAutonomousTasks({ maxTasks: 5 });
      expect(calledFeedbackSynth).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.id).toBe("fb-exp-task");
    });
  });

  describe("processAutonomousDualIntake & runAutonomousDualIntakeCycle", () => {
    it("handles Mode B: pending feedback ingestion regardless of active tasks", () => {
      spies.push(
        spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([
          makeFeedback({ id: "fb-intake-1", status: "PENDING" }),
        ]),
      );
      spies.push(
        spyOn(queueMod, "readTaskQueue").mockReturnValue([
          makeTask("task-act-0", "RUNNING", "HIGH"),
          makeTask("task-synth-1", "PENDING", "CRITICAL"),
        ]),
      );
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromFeedbackQueue").mockReturnValue({
          tasks: [makeMockPlan("task-synth-1")],
          summary: "mode b feedback ingestion",
          source_type: "feedback_queue",
        }),
      );

      const result = processAutonomousDualIntake();
      expect(result.mode).toBe("Mode_B_External_Intake");
      expect(result.synthesized_plans).toHaveLength(1);
      expect(result.admitted_feedback_ids).toEqual(["fb-intake-1"]);
      expect(result.summary).toContain("Mode B External Intake");
    });

    it("enforces maxTasks quota admitting exactly N items and retaining remaining items in PENDING", () => {
      const feedbacks = [1, 2, 3, 4, 5].map((i) =>
        makeFeedback({ id: `fb-quota-${i}`, status: "PENDING" }),
      );

      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue(feedbacks));
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue([]));
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromFeedbackQueue").mockImplementation(
          (options) => {
            const limit = options?.maxTasks ?? 10;
            const tasks = feedbacks.slice(0, limit).map((f) => makeMockPlan(`task-${f.id}`));
            return { tasks, summary: `admitted ${tasks.length}`, source_type: "feedback_queue" };
          },
        ),
      );

      const resultSingle = processAutonomousDualIntake({ maxTasks: 1 });
      expect(resultSingle.synthesized_plans).toHaveLength(1);
      expect(resultSingle.admitted_feedback_ids).toEqual(["fb-quota-1"]);

      const result = processAutonomousDualIntake({ maxTasks: 2 });
      expect(result.mode).toBe("Mode_B_External_Intake");
      expect(result.synthesized_plans).toHaveLength(2);
      expect(result.admitted_feedback_ids).toEqual(["fb-quota-1", "fb-quota-2"]);

      const remainingUnadmitted = feedbacks.filter(
        (f) => !result.admitted_feedback_ids.includes(f.id),
      );
      expect(remainingUnadmitted).toHaveLength(3);
      expect(remainingUnadmitted.every((f) => f.status === "PENDING")).toBe(true);
    });

    it("handles Mode A self evolution when feedback is empty and active queue is zero", () => {
      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([]));
      spies.push(
        spyOn(queueMod, "readTaskQueue").mockReturnValue([
          makeTask("task-done", "COMPLETED", "NORMAL"),
        ]),
      );
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromSelfEvolution").mockReturnValue({
          tasks: [makeMockPlan("task-evo-idle")],
          summary: "self evolution plan",
          source_type: "self_evolution",
        }),
      );

      const result = runAutonomousDualIntakeCycle();
      expect(result.mode).toBe("Mode_A_Self_Evolution");
      expect(result.synthesized_plans).toHaveLength(1);
      expect(result.synthesized_plans[0]?.id).toBe("task-evo-idle");
    });

    it("short-circuits to Queue_Active when tasks are already in flight and feedback is empty", () => {
      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([]));
      spies.push(
        spyOn(queueMod, "readTaskQueue").mockReturnValue([
          makeTask("task-running", "RUNNING", "HIGH"),
        ]),
      );

      const result = processAutonomousDualIntake();
      expect(result.mode).toBe("Queue_Active");
      expect(result.synthesized_plans).toEqual([]);
      expect(result.enqueued_tasks).toEqual([]);
    });

    it("falls back to Mode A self evolution when task queue contains only inactive tasks", () => {
      const inactiveTasks = [
        makeTask("task-failed", "FAILED", "LOW"),
        makeTask("task-escalated", "ESCALATED", "HIGH"),
      ];
      spies.push(spyOn(feedbackMod, "readFeedbackQueue").mockReturnValue([]));
      spies.push(spyOn(queueMod, "readTaskQueue").mockReturnValue(inactiveTasks));
      spies.push(
        spyOn(evolutionMod, "synthesizeSmartTasksFromSelfEvolution").mockReturnValue({
          tasks: [makeMockPlan("task-evo-fallback")],
          summary: "self evolution fallback",
          source_type: "self_evolution",
        }),
      );

      const result = processAutonomousDualIntake();
      expect(result.mode).toBe("Mode_A_Self_Evolution");
      expect(result.synthesized_plans).toHaveLength(1);
      expect(result.synthesized_plans[0]?.id).toBe("task-evo-fallback");
    });
  });

  describe("expandExternalPromptToPlan & planEnhance", () => {
    it("expands an external raw prompt into a structured task plan with exact anchors", () => {
      expect(() => expandExternalPromptToPlan("")).toThrow(HarnessError);
      expect(() => expandExternalPromptToPlan("   ")).toThrow(HarnessError);

      const prompt = "Audit sentinel boundaries and harden watchdog dispatch";
      const plan = expandExternalPromptToPlan(prompt, {
        baseId: "custom-sentinel-audit",
        charterGoals: ["Boundary Enforcement"],
        priority: "CRITICAL",
        writeScope: ["src/sentinel/watchdog.ts"],
        gate: "bun test",
        assignedTier: "Tier_1_Orchestrator",
        assignedImplementer: "implementer_mind_tasks_perf",
        assignedValidator: "validator_mind_tasks_perf",
      });

      expect(plan.id).toBe("custom-sentinel-audit");
      expect(plan.priority).toBe("CRITICAL");
      expect(plan.write_scope).toEqual(["src/sentinel/watchdog.ts"]);
      expect(plan.gate).toBe("bun test");
      expect(plan.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(plan.assigned_implementer).toBe("implementer_mind_tasks_perf");
    });

    it("enhances plan with feedback critique and enriched acceptance criteria", () => {
      const planStr = planEnhance("Enhance task graph compiler", {
        priority: "HIGH",
      });
      expect(planStr.label).toBe("Enhance task graph compiler");
      expect(planStr.priority).toBe("HIGH");
      expect(planStr.acceptance_criteria[0]).toContain(
        "Implement requirements declared in: Enhance task graph compiler",
      );

      const fb = makeFeedback({
        id: "fb-purity-1",
        title: "Purity AST Linter Enforcement",
        category: "VALIDATION",
        priority: "CRITICAL_USER_FEEDBACK",
      });
      const planFb = planEnhance(fb, {
        baseId: "task-purity-enforcement",
        charterGoals: ["Zero Disk IO"],
        priority: "CRITICAL",
      });
      expect(planFb.id).toBe("task-purity-enforcement");
      expect(planFb.source_type).toBe("plan_enhancement");
      expect(planFb.label).toBe("Purity AST Linter Enforcement");
      expect(planFb.rationale).toContain("VirtualMemoryFS");

      const minimalFb = {
        id: "fb-min",
        title: "Minimal Feedback",
        content: "Minimal content",
      } as FeedbackItem;
      const planMin = planEnhance(minimalFb);
      expect(planMin.id).toBe("task-fb-min");
      expect(planMin.priority).toBe("MEDIUM");
    });
  });
});
