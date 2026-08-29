import type { SmartTaskPlan } from "../planner/models.ts";
import type { TaskPriority } from "../../../../task/queue/index.ts";
import { mapFeedbackPriorityToTaskPriority } from "./orchestrator.ts";

export interface TaskPrioritySynthesisOptions {
  readonly defaultPriority?: TaskPriority | undefined;
  readonly boostGoals?: readonly string[] | undefined;
  readonly propagateDependencies?: boolean | undefined;
  readonly sortByPriority?: boolean | undefined;
  readonly sourceOverrides?: Readonly<Partial<Record<string, TaskPriority>>> | undefined;
}

const TASK_PRIORITY_WEIGHTS: Readonly<Record<TaskPriority, number>> = {
  CRITICAL: 100,
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25,
  BACKGROUND: 10,
};

function weightToPriority(weight: number): TaskPriority {
  if (weight >= 100) return "CRITICAL";
  if (weight >= 75) return "HIGH";
  if (weight >= 50) return "MEDIUM";
  if (weight >= 25) return "LOW";
  return "BACKGROUND";
}

function resolveInitialTaskPriority(
  task: SmartTaskPlan,
  options?: TaskPrioritySynthesisOptions,
): TaskPriority {
  if (options?.sourceOverrides && task.source_type && options.sourceOverrides[task.source_type]) {
    return options.sourceOverrides[task.source_type]!;
  }
  if (task.priority) {
    if (
      task.priority === "CRITICAL" ||
      task.priority === "HIGH" ||
      task.priority === "MEDIUM" ||
      task.priority === "LOW" ||
      task.priority === "BACKGROUND"
    ) {
      return task.priority;
    }
    return mapFeedbackPriorityToTaskPriority(task.priority);
  }

  const text = `${task.label} ${task.rationale}`.toLowerCase();
  if (
    text.includes("critical") ||
    text.includes("security") ||
    text.includes("cve") ||
    text.includes("fatal") ||
    text.includes("blocker")
  ) {
    return "CRITICAL";
  }
  if (
    text.includes("urgent") ||
    text.includes("high") ||
    text.includes("perf") ||
    text.includes("regression")
  ) {
    return "HIGH";
  }
  if (
    text.includes("low") ||
    text.includes("minor") ||
    text.includes("doc") ||
    text.includes("cleanup") ||
    text.includes("chore")
  ) {
    return "LOW";
  }

  const source = task.source_type;
  if (source === "defect_remediation") return "CRITICAL";
  if (
    source === "feedback_intake" ||
    source === "plan_enhancement" ||
    source === "external_intake" ||
    source === "direct_prompt"
  ) {
    return "HIGH";
  }
  if (source === "self_evolution") return "MEDIUM";

  return options?.defaultPriority ?? "MEDIUM";
}

export function synthesizeTaskPriorities(
  tasks: readonly SmartTaskPlan[],
  options?: TaskPrioritySynthesisOptions | undefined,
): readonly SmartTaskPlan[] {
  if (tasks.length === 0) return [];

  const taskMap = new Map<string, TaskPriority>();
  for (const t of tasks) {
    taskMap.set(t.id, resolveInitialTaskPriority(t, options));
  }

  const boostGoals = options?.boostGoals ?? [];
  if (boostGoals.length > 0) {
    for (const t of tasks) {
      if (t.charter_goals && t.charter_goals.some((g) => boostGoals.includes(g))) {
        const cur = taskMap.get(t.id)!;
        if (cur === "BACKGROUND") taskMap.set(t.id, "LOW");
        else if (cur === "LOW") taskMap.set(t.id, "MEDIUM");
        else if (cur === "MEDIUM") taskMap.set(t.id, "HIGH");
        else if (cur === "HIGH") taskMap.set(t.id, "CRITICAL");
      }
    }
  }

  const propagate = options?.propagateDependencies !== false;
  if (propagate) {
    let changed = true;
    let passes = 0;
    while (changed && passes < tasks.length + 1) {
      changed = false;
      passes += 1;
      for (const t of tasks) {
        const curPriority = taskMap.get(t.id)!;
        const curWeight = TASK_PRIORITY_WEIGHTS[curPriority];
        for (const depId of t.dependencies) {
          if (taskMap.has(depId)) {
            const depPri = taskMap.get(depId)!;
            const depWeight = TASK_PRIORITY_WEIGHTS[depPri];
            if (curWeight > depWeight) {
              taskMap.set(depId, weightToPriority(curWeight));
              changed = true;
            }
          }
        }
      }
    }
  }

  const updatedTasks: SmartTaskPlan[] = tasks.map((t: SmartTaskPlan) => ({
    ...t,
    priority: taskMap.get(t.id) ?? "MEDIUM",
  }));

  if (options?.sortByPriority === false) {
    return updatedTasks;
  }

  return [...updatedTasks].sort((a: SmartTaskPlan, b: SmartTaskPlan) => {
    const pA = a.priority ?? "MEDIUM";
    const pB = b.priority ?? "MEDIUM";
    const wDiff = TASK_PRIORITY_WEIGHTS[pB] - TASK_PRIORITY_WEIGHTS[pA];
    if (wDiff !== 0) return wDiff;
    return 0;
  });
}
