
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

import { extractTasksFromState } from "./hyper-cognition-chunk3.ts";
import { PROACTIVE_QUESTION_CATALOG } from "./hyper-cognition-chunk1.ts";
import type {
  DiscoveredSubtask,
  PlanEnhancementHarvest,
  ProactiveQuestionCycle,
  ProactiveQuestionSpec,
} from "./hyper-cognition-chunk1.ts";
import type { QuestionCycleInput } from "./hyper-cognition-chunk2.ts";


export function executeProactiveSelfQuestioningCycle(
  input: QuestionCycleInput,
): ProactiveQuestionCycle {
  const timestamp = input.timestamp !== undefined ? input.timestamp : new Date().toISOString();
  const defaultSpec = PROACTIVE_QUESTION_CATALOG[0];
  if (defaultSpec === undefined) {
    throw new HarnessError("INTEGRITY", "PROACTIVE_QUESTION_CATALOG must not be empty");
  }

  let spec: ProactiveQuestionSpec = defaultSpec;

  if (input.questionId !== undefined) {
    const found = PROACTIVE_QUESTION_CATALOG.find((q) => q.id === input.questionId);
    if (found !== undefined) {
      spec = found;
    }
  } else {
    const cycleIndex = Math.abs(hashCode(input.cycleId)) % PROACTIVE_QUESTION_CATALOG.length;
    const indexed = PROACTIVE_QUESTION_CATALOG[cycleIndex];
    if (indexed !== undefined) {
      spec = indexed;
    }
  }

  const hypothesis =
    input.overrideHypothesis !== undefined ? input.overrideHypothesis : spec.defaultHypothesis;

  const investigationFindings: string[] = [];
  const proposals: OptimizationProposal[] = [];
  const tasks = extractTasksFromState(input.state);

  investigationFindings.push(
    `Audited ${tasks.length} tasks and active graph edges against question: "${spec.question}"`,
  );
  investigationFindings.push(`Evaluated hypothesis against system state: "${hypothesis}"`);

  if (spec.dimension === "dag_concurrency" || spec.dimension === "performance") {
    let parallelOpportunities = 0;
    for (let i = 0; i < tasks.length; i += 1) {
      const taskA = tasks[i];
      if (taskA !== undefined) {
        for (let j = i + 1; j < tasks.length; j += 1) {
          const taskB = tasks[j];
          if (taskB !== undefined) {
            const hasDep =
              taskB.dependencies.includes(taskA.id) || taskA.dependencies.includes(taskB.id);
            const overlapping = taskA.write_scope.some((sA) =>
              taskB.write_scope.some((sB) => sA === sB),
            );
            if (!hasDep && !overlapping) {
              parallelOpportunities += 1;
            }
          }
        }
      }
    }
    investigationFindings.push(
      `Discovered ${parallelOpportunities} potential parallel execution pairings with disjoint scopes.`,
    );

    proposals.push({
      id: `OPT-CONCURRENCY-${input.cycleId}`,
      title: "Dynamic Concurrency Expansion",
      dimension: "dag_concurrency",
      expectedBenefit:
        parallelOpportunities > 0
          ? `Unlock parallel execution across ${parallelOpportunities} non-conflicting task pairs.`
          : "Evaluate DAG structure to expose prospective parallel lanes and decouple serial bottlenecks.",
      riskAssessment: "low",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 10,
      status: "proposed",
      createdAt: timestamp,
    });
  } else if (spec.dimension === "ast_purity" || spec.dimension === "type_safety") {
    investigationFindings.push(
      `Enforced zero-fallback operator rule across repository contracts and state transitions.`,
    );
    proposals.push({
      id: `OPT-AST-PURITY-${input.cycleId}`,
      title: "Zero-Fallback AST Hardening",
      dimension: "ast_purity",
      expectedBenefit:
        "Eliminate silent fallback operators and mandate explicit validation predicates.",
      riskAssessment: "low",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 8,
      status: "proposed",
      createdAt: timestamp,
    });
  } else {
    investigationFindings.push(
      `Analyzed architectural boundaries for simplicity, radical observability, and token parsimony.`,
    );
    proposals.push({
      id: `OPT-ELEGANCE-${input.cycleId}`,
      title: "First-Principles Structural Simplification",
      dimension: spec.dimension,
      expectedBenefit: "Streamline execution flow and eliminate redundant coordinator overhead.",
      riskAssessment: "medium",
      targetFiles: tasks.flatMap((t) => t.write_scope),
      scoreBoost: 6,
      status: "proposed",
      createdAt: timestamp,
    });
  }

  return {
    cycleId: input.cycleId,
    questionId: spec.id,
    questionText: spec.question,
    dimension: spec.dimension,
    flavorDimension: spec.flavorDimension,
    hypothesis,
    investigationFindings,
    synthesizedProposals: proposals,
    evaluatedAt: timestamp,
  };
}


export function harvestPlanEnhancementsDuringPulse(
  context: MindPulseContext,
): PlanEnhancementHarvest {
  const timestamp = context.timestamp !== undefined ? context.timestamp : new Date().toISOString();
  const tasks = extractTasksFromState(context.state);

  const enhancedCriteria: string[] = [];
  const suggestedSubtasks: DiscoveredSubtask[] = [];
  const identifiedBottlenecks: string[] = [];
  const parallelizableLanes: string[] = [];
  const sourceTaskIds: string[] = [];

  for (const task of tasks) {
    sourceTaskIds.push(task.id);

    if (task.write_scope.length > 2) {
      identifiedBottlenecks.push(
        `Task ${task.id} has ${task.write_scope.length} target files, which may create a lock contention bottleneck.`,
      );

      enhancedCriteria.push(
        `Criterion for ${task.id}: Verify individual file AST integrity independently.`,
      );

      task.write_scope.forEach((scopePath, index) => {
        suggestedSubtasks.push({
          taskId: `${task.id}-sub-${index + 1}`,
          title: `Partitioned Subtask for ${scopePath}`,
          writeScope: [scopePath],
          gateCommand: task.gate_command !== undefined ? task.gate_command : "bun test",
          dependencies: [],
          estimatedEffort: 1,
          rationale: `Decomposed from monolithic task ${task.id} to isolate file edits and allow parallel worker execution.`,
        });
      });
    }

    if (task.dependencies.length === 0 && (task.status === "ready" || task.status === "leased")) {
      parallelizableLanes.push(`Lane-${task.id}`);
    }
  }

  enhancedCriteria.push(
    "Verify complete absence of TypeScript `any` and defaulted literal fallback operators.",
  );
  enhancedCriteria.push(
    "Verify all gate commands execute under real process isolation with evidence recording.",
  );

  return {
    harvestId: `HARVEST-${context.pulseId}`,
    pulseId: context.pulseId,
    sourceTaskIds,
    enhancedCriteria,
    suggestedSubtasks,
    identifiedBottlenecks,
    parallelizableLanes,
    harvestedAt: timestamp,
    applied: false,
  };
}
