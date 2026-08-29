import { MAX_REPAIR_ROUNDS } from "../core/config/contracts.ts";
import type { Finding } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import {
  routeCriticReviewFindings,
  type RouteCriticFindingsOptions,
  type RouteCriticFindingsResult,
  type TaskRepairSummary,
} from "../workflow/completion/critic-feedback-loop.ts";
import type { CompletionReview } from "../workflow/completion/types.ts";
import type { TransactionPort, WorkflowState } from "../workflow/types.ts";
import { normalizeFindingToDetail, synthesizeNextRoundPrompt } from "./defect-synthesizer.ts";
import type { DefectSynthesis, RoundGateResult } from "./types.ts";

export interface TaskRepairInstruction {
  readonly taskId: string;
  readonly repairAssignee: string;
  readonly repairRound: number;
  readonly writeScope: readonly string[];
  readonly findings: readonly Finding[];
  readonly remediationInstructions: string;
  readonly revalidationGates: readonly string[];
}

export interface RecursiveFeedbackLoopOutcome {
  readonly routingResult: RouteCriticFindingsResult;
  readonly defectSynthesis?: DefectSynthesis | undefined;
  readonly repairInstructions: readonly TaskRepairInstruction[];
  readonly totalTasksInRepair: number;
  readonly totalTasksEscalated: number;
  readonly isConverged: boolean;
}

export interface RecursiveFeedbackOptions extends RouteCriticFindingsOptions {
  readonly roundNumber?: number | undefined;
  readonly runId?: string | undefined;
  readonly originalPrompt?: string | undefined;
  readonly gateResults?: readonly RoundGateResult[] | undefined;
}

export function generateRepairInstructions(
  state: WorkflowState,
  repairSummaries: readonly TaskRepairSummary[],
): TaskRepairInstruction[] {
  const instructions: TaskRepairInstruction[] = [];

  for (const summary of repairSummaries) {
    if (summary.newStatus !== "changes_requested") continue;
    const task = state.tasks[summary.taskId];
    if (!task) continue;

    const taskFindings = (task.findings ?? []).filter((f) => f.status === "open");
    const revalidationGates = Array.from(
      new Set(taskFindings.map((f) => f.revalidation).filter((g) => g && g.trim().length > 0)),
    );

    const remediationLines: string[] = [];
    remediationLines.push(`### Task Repair Directive: [${task.id}] (Round ${task.repair_round})`);
    remediationLines.push(`**Assignee:** \`${summary.repairAssignee}\``);
    remediationLines.push(
      `**Scoped Write Paths:** ${task.write_scope.map((s) => `\`${s}\``).join(", ")}`,
    );
    remediationLines.push("");
    remediationLines.push("#### Open Findings to Remediate:");
    for (const f of taskFindings) {
      remediationLines.push(`- **[${f.id}]** ${f.observation}`);
      remediationLines.push(`  - **Required Remediation:** ${f.remediation}`);
      if (f.revalidation) remediationLines.push(`  - **Revalidation Gate:** \`${f.revalidation}\``);
    }

    instructions.push({
      taskId: task.id,
      repairAssignee: summary.repairAssignee,
      repairRound: task.repair_round,
      writeScope: [...task.write_scope],
      findings: taskFindings,
      remediationInstructions: remediationLines.join("\n"),
      revalidationGates,
    });
  }

  return instructions;
}

export function processCriticFeedbackLoop(
  port: TransactionPort,
  orchestratorActor: string,
  review: CompletionReview,
  options: RecursiveFeedbackOptions = {},
): RecursiveFeedbackLoopOutcome {
  if (review.status === "clean") {
    return {
      routingResult: {
        reviewedStatus: "clean",
        totalFindingsRouted: 0,
        affectedTaskIds: [],
        changesRequestedTaskIds: [],
        escalatedTaskIds: [],
        summaries: [],
      },
      repairInstructions: [],
      totalTasksInRepair: 0,
      totalTasksEscalated: 0,
      isConverged: true,
    };
  }

  const routingResult = routeCriticReviewFindings(port, orchestratorActor, review, options);
  const updatedState = port.read();

  const repairInstructions = generateRepairInstructions(updatedState, routingResult.summaries);

  const defectSynthesis = synthesizeNextRoundPrompt({
    roundNumber: options.roundNumber ?? 2,
    priorRunId: options.runId ?? "run-current",
    originalPrompt: options.originalPrompt ?? "Complete objective",
    findings: routingResult.summaries.flatMap((s) => {
      const task = updatedState.tasks[s.taskId];
      return task?.findings ?? [];
    }),
    criticFeedback: review.summary,
    gateResults: options.gateResults,
  });

  return {
    routingResult,
    defectSynthesis,
    repairInstructions,
    totalTasksInRepair: routingResult.changesRequestedTaskIds.length,
    totalTasksEscalated: routingResult.escalatedTaskIds.length,
    isConverged: false,
  };
}

export interface RepairCycleEscalationReport {
  readonly changesRequestedCount: number;
  readonly escalatedCount: number;
  readonly nearBudgetTasks: readonly string[];
  readonly exhaustedTasks: readonly string[];
}

export function evaluateRepairCycleStatus(
  state: WorkflowState,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): RepairCycleEscalationReport {
  const nearBudget: string[] = [];
  const exhausted: string[] = [];
  let changesRequestedCount = 0;
  let escalatedCount = 0;

  for (const task of Object.values(state.tasks)) {
    if (task.status === "changes_requested") {
      changesRequestedCount += 1;
      const round = task.repair_round ?? 0;
      if (round >= maxRepairRounds) {
        exhausted.push(task.id);
      } else if (round === maxRepairRounds - 1) {
        nearBudget.push(task.id);
      }
    } else if (task.status === "escalated") {
      escalatedCount += 1;
    }
  }

  return {
    changesRequestedCount,
    escalatedCount,
    nearBudgetTasks: nearBudget.sort(),
    exhaustedTasks: exhausted.sort(),
  };
}
