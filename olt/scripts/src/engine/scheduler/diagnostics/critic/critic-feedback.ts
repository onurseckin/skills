import { MAX_REPAIR_ROUNDS } from "../../../../core/config/contracts.ts";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { archiveOpenValidations } from "../../../../workflow/review/validation-state.ts";
import { requireText, taskIn, transition } from "../../../../workflow/task-state.ts";
import { systemClock, type TransactionPort } from "../../../../workflow/types.ts";
import { assertHierarchicalCompliance } from "../../conflict/decision-tree.ts";
import type {
  ReviewerRole,
  CriticFindingInput,
  CriticFindingDetail,
  PairAssignmentStrategy,
  ImplementerValidatorBinding,
  ClosedLoopRepairPayload,
  CompiledRepairDagNode,
  CompiledRepairDag,
  RouteCriticFeedbackOptions,
  ConvergenceReport,
} from "./critic-types.ts";
import {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  matchTasksForFinding,
  parseCriticFindingsInput,
} from "./critic-normalization.ts";
import { compileRepairDag, evaluateRepairCycleConvergence } from "./repair-dag.ts";

export {
  type ReviewerRole,
  type CriticFindingInput,
  type CriticFindingDetail,
  type PairAssignmentStrategy,
  type ImplementerValidatorBinding,
  type ClosedLoopRepairPayload,
  type CompiledRepairDagNode,
  type CompiledRepairDag,
  type RouteCriticFeedbackOptions,
  type ConvergenceReport,
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  compileRepairDag,
  evaluateRepairCycleConvergence,
};

export interface RouteCriticFeedbackResult {
  readonly roundNumber: number;
  readonly sourceReviewerRole: ReviewerRole;
  readonly sourceReviewerActor: string;
  readonly totalFindingsRouted: number;
  readonly totalTasksInRepair: number;
  readonly totalTasksEscalated: number;
  readonly isConverged: boolean;
  readonly payloads: readonly ClosedLoopRepairPayload[];
  readonly affectedTaskIds: readonly string[];
  readonly changesRequestedTaskIds: readonly string[];
  readonly escalatedTaskIds: readonly string[];
  readonly compiledDag: CompiledRepairDag;
}

export function routeCriticFeedback(
  port: TransactionPort,
  reviewer: { actor: string; role: ReviewerRole },
  findingsInput:
    | readonly unknown[]
    | {
        findings?: readonly unknown[];
        status?: string;
        summary?: string;
        requirement_proofs?: readonly { requirement_id: string; status: string }[];
      },
  options: RouteCriticFeedbackOptions & {
    defaultRevalidationCommand?: string | undefined;
    graphRevision?: number | undefined;
  } = {},
): RouteCriticFeedbackResult {
  const actor = requireText(reviewer.actor, "actor");
  const clock = options.clock ?? systemClock;
  const maxRepairRounds = options.maxRepairRounds ?? MAX_REPAIR_ROUNDS;
  const pairStrategy =
    typeof options.pairStrategy === "string" ? options.pairStrategy : "replacement_pair";
  const now = clock.now();

  const hierarchicalAction =
    reviewer.role === "completeness-critic" ? "critic_review" : "record_review";
  assertHierarchicalCompliance({ actor, role: reviewer.role }, hierarchicalAction);

  const { reviewStatus, parsedFindings } = parseCriticFindingsInput(findingsInput);

  const initialState = port.read();
  const currentMaxRound = Object.values(initialState.tasks).reduce(
    (max, t) => Math.max(max, t.repair_round ?? 0),
    0,
  );
  const nextRoundNumber = currentMaxRound + 1;

  if (reviewStatus === "clean" || parsedFindings.length === 0) {
    const emptyDag = compileRepairDag([], initialState, nextRoundNumber);
    return {
      roundNumber: nextRoundNumber,
      sourceReviewerRole: reviewer.role,
      sourceReviewerActor: actor,
      totalFindingsRouted: 0,
      totalTasksInRepair: 0,
      totalTasksEscalated: 0,
      isConverged: true,
      payloads: [],
      affectedTaskIds: [],
      changesRequestedTaskIds: [],
      escalatedTaskIds: [],
      compiledDag: emptyDag,
    };
  }

  let finalPayloads: ClosedLoopRepairPayload[] = [];
  let changesRequestedTaskIds: string[] = [];
  let escalatedTaskIds: string[] = [];
  let affectedTaskIds: string[] = [];

  port.transact(
    actor,
    "critic-feedback-routed",
    {
      reviewer_role: reviewer.role,
      reviewer_actor: actor,
      round_number: nextRoundNumber,
      findings_count: parsedFindings.length,
    },
    (draft) => {
      const taskFindingsMap = new Map<string, CriticFindingDetail[]>();

      for (const finding of parsedFindings) {
        const targetTasks = matchTasksForFinding(draft.tasks, finding);
        for (const task of targetTasks) {
          const list = taskFindingsMap.get(task.id) ?? [];
          list.push(finding);
          taskFindingsMap.set(task.id, list);
        }
      }

      const payloads: ClosedLoopRepairPayload[] = [];
      const chgReq: string[] = [];
      const esc: string[] = [];

      for (const [taskId, findings] of taskFindingsMap.entries()) {
        const task = taskIn(draft, taskId);
        const priorStatus = task.status;
        const currentRound = (task.repair_round ?? 0) + 1;
        task.repair_round = currentRound;

        const isDeterministic = findings.some((f) => detectDeterministicRepeat(task.findings, f));
        const isExhausted = currentRound >= maxRepairRounds;
        const shouldEscalate = isDeterministic || isExhausted;

        const binding = selectImplementerValidatorPair(
          task,
          currentRound,
          pairStrategy,
          options.availableImplementers,
          options.availableValidators,
        );

        task.repair_assignee = binding.implementerId;

        task.findings ??= [];
        for (const f of findings) {
          if (!task.findings.some((existing) => existing.id === f.id)) {
            task.findings.push({
              id: f.id,
              requirement_id: f.requirement_id,
              severity: f.severity,
              observation: f.observation,
              evidence: [...f.evidence] as JsonObject[],
              remediation: f.remediation,
              revalidation: f.revalidation,
              status: "open",
            });
          }
        }

        const newStatus: "changes_requested" | "escalated" = shouldEscalate
          ? "escalated"
          : "changes_requested";

        const escalationReason = isDeterministic
          ? `Deterministic defect repeated in repair cycle: ${findings.map((f) => f.id).join(", ")}`
          : isExhausted
            ? `Repair rounds exhausted (${currentRound}/${maxRepairRounds})`
            : undefined;

        const reason =
          escalationReason ?? `Reviewer ${actor} requested changes (Round ${currentRound})`;

        transition(task, newStatus, actor, now, reason);
        archiveOpenValidations(task);

        if (shouldEscalate) {
          esc.push(taskId);
        } else {
          chgReq.push(taskId);
        }

        const counterfactualRequirements = findings.map((f) => f.counterfactualRequirement);
        const revalidationGates = Array.from(
          new Set(
            findings
              .map((f) => f.revalidation)
              .filter((g) => g && g.trim().length > 0)
              .concat(
                options.defaultRevalidationCommand ? [options.defaultRevalidationCommand] : [],
              ),
          ),
        );

        const directiveLines: string[] = [
          `### 🛠️ CLOSED-LOOP REPAIR DIRECTIVE: [${task.id}] (Round ${currentRound})`,
          `- **Assigned Repairer**: \`${binding.implementerId}\`${binding.isReplacementPair ? " *(Replacement Clean-Slate Assignee)*" : ""}`,
          `- **Assigned Validator**: \`${binding.validatorId}\``,
          `- **Strict Leased Write Scope**: ${task.write_scope.map((s) => `\`${s}\``).join(", ")}`,
          `- **Counterfactual Requirements**:`,
          ...counterfactualRequirements.map((r) => `  - ${r}`),
          `- **Revalidation Gates**:`,
          ...revalidationGates.map((g) => `  - \`${g}\``),
          "",
          "#### Open Findings to Remediate:",
          ...findings.map(
            (f) =>
              `- **[${f.id}] (${f.severity.toUpperCase()})**: ${f.observation}\n  - **Remediation**: ${f.remediation}\n  - **Counterfactual**: ${f.counterfactualRequirement}`,
          ),
        ];

        payloads.push({
          taskId,
          repairRound: currentRound,
          priorStatus,
          newStatus,
          binding,
          writeScope: [...task.write_scope],
          findings,
          counterfactualRequirements,
          revalidationGates,
          repairDirectives: directiveLines.join("\n"),
          isEscalated: shouldEscalate,
          escalationReason,
        });
      }

      finalPayloads = payloads;
      changesRequestedTaskIds = chgReq.sort();
      escalatedTaskIds = esc.sort();
      affectedTaskIds = Array.from(taskFindingsMap.keys()).sort();
    },
  );

  const updatedState = port.read();
  const compiledDag = compileRepairDag(finalPayloads, updatedState, nextRoundNumber);

  return {
    roundNumber: nextRoundNumber,
    sourceReviewerRole: reviewer.role,
    sourceReviewerActor: actor,
    totalFindingsRouted: parsedFindings.length,
    totalTasksInRepair: changesRequestedTaskIds.length,
    totalTasksEscalated: escalatedTaskIds.length,
    isConverged: false,
    payloads: finalPayloads,
    affectedTaskIds,
    changesRequestedTaskIds,
    escalatedTaskIds,
    compiledDag,
  };
}
