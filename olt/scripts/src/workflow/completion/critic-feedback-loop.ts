import { MAX_REPAIR_ROUNDS } from "../../core/config/contracts.ts";
import type { Finding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { archiveOpenValidations } from "../review/validation-state.ts";
import { requireText, taskIn, transition, utc } from "../task-state.ts";
import {
  systemClock,
  type Clock,
  type TaskRecord,
  type TransactionPort,
  type WorkflowState,
} from "../types.ts";
import type { CompletionFinding, CompletionReview } from "./types.ts";

export interface RouteCriticFindingsOptions {
  readonly maxRepairRounds?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly escalationThresholdRepeatFindings?: number | undefined;
}

export interface TaskRepairSummary {
  readonly taskId: string;
  readonly priorStatus: string;
  readonly newStatus: "changes_requested" | "escalated";
  readonly repairRound: number;
  readonly repairAssignee: string;
  readonly assignedFindingsCount: number;
  readonly isEscalated: boolean;
  readonly escalationReason?: string | undefined;
}

export interface RouteCriticFindingsResult {
  readonly reviewedStatus: "clean" | "findings";
  readonly totalFindingsRouted: number;
  readonly affectedTaskIds: readonly string[];
  readonly changesRequestedTaskIds: readonly string[];
  readonly escalatedTaskIds: readonly string[];
  readonly summaries: readonly TaskRepairSummary[];
}

export interface TaskRepairBudgetStatus {
  readonly repairRound: number;
  readonly maxRepairRounds: number;
  readonly remainingBudget: number;
  readonly isExhausted: boolean;
  readonly deterministicDefectDetected: boolean;
}

export function generateStructuredFindingsFromCritic(reviewValue: unknown): Finding[] {
  if (typeof reviewValue !== "object" || reviewValue === null || Array.isArray(reviewValue)) {
    return [];
  }
  const review = reviewValue as Partial<CompletionReview>;
  const findings: Finding[] = [];

  if (Array.isArray(review.findings)) {
    for (const f of review.findings) {
      if (typeof f.id === "string" && f.id.trim()) {
        findings.push({
          id: f.id,
          requirement_id: typeof f.requirement_id === "string" ? f.requirement_id : "general",
          severity:
            f.severity === "minor" ? "minor" : f.severity === "critical" ? "critical" : "important",
          observation: typeof f.observation === "string" ? f.observation : "Critic defect detected",
          evidence: Array.isArray(f.evidence) ? f.evidence : [],
          remediation:
            typeof f.remediation === "string"
              ? f.remediation
              : "Remediate finding and verify with non-mocked tests",
          revalidation: typeof f.revalidation === "string" ? f.revalidation : "",
          status: "open",
        });
      }
    }
  }

  // Also convert unproven requirements into findings if status is findings
  if (review.status === "findings" && Array.isArray(review.requirement_proofs)) {
    for (const proof of review.requirement_proofs) {
      if (proof.status === "unproven") {
        const findingId = `UNPROVEN-REQ-${proof.requirement_id}`;
        if (!findings.some((f) => f.id === findingId)) {
          findings.push({
            id: findingId,
            requirement_id: proof.requirement_id,
            severity: "critical",
            observation: `Requirement ${proof.requirement_id} remains unproven in completeness review`,
            evidence: Array.isArray(proof.evidence) ? proof.evidence : [],
            remediation: `Implement non-mocked automated validation proving requirement ${proof.requirement_id}`,
            revalidation: `bun test --filter ${proof.requirement_id}`,
            status: "open",
          });
        }
      }
    }
  }

  return findings;
}

export function isDeterministicFindingRepeat(task: TaskRecord, newFinding: Finding): boolean {
  if (!Array.isArray(task.findings) || task.findings.length === 0) {
    return false;
  }
  return task.findings.some(
    (prior) =>
      prior.id === newFinding.id ||
      (prior.requirement_id === newFinding.requirement_id &&
        prior.observation.trim().toLowerCase() === newFinding.observation.trim().toLowerCase() &&
        prior.status === "open"),
  );
}

export function trackTaskRepairBudget(
  task: TaskRecord,
  maxRepairRounds: number = MAX_REPAIR_ROUNDS,
): TaskRepairBudgetStatus {
  const currentRound = typeof task.repair_round === "number" ? task.repair_round : 0;
  const remaining = Math.max(0, maxRepairRounds - currentRound);
  const isExhausted = currentRound >= maxRepairRounds;

  // Check if any finding has repeated across multiple validation attempts
  let repeatCount = 0;
  if (Array.isArray(task.findings)) {
    const ids = task.findings.map((f) => f.id);
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) repeatCount += 1;
      seen.add(id);
    }
  }

  return {
    repairRound: currentRound,
    maxRepairRounds,
    remainingBudget: remaining,
    isExhausted,
    deterministicDefectDetected: repeatCount >= 2,
  };
}

function findTasksForFinding(tasks: Record<string, TaskRecord>, finding: Finding): TaskRecord[] {
  const matched: TaskRecord[] = [];

  // Match by requirement_id
  for (const task of Object.values(tasks)) {
    if (task.requirement_ids.includes(finding.requirement_id)) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  // Fallback: match by file paths in observation or remediation
  for (const task of Object.values(tasks)) {
    const hasOverlap = task.write_scope.some(
      (scope) => finding.observation.includes(scope) || finding.remediation.includes(scope),
    );
    if (hasOverlap) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  // If still not matched, return all tasks that are done/validated or currently active
  const candidateTasks = Object.values(tasks).filter(
    (t) => t.status === "done" || t.status === "validated" || t.status === "changes_requested",
  );
  return candidateTasks.length > 0 ? [candidateTasks[0]!] : Object.values(tasks);
}

export function routeCriticReviewFindings(
  port: TransactionPort,
  actor: string,
  reviewValue: unknown,
  options: RouteCriticFindingsOptions = {},
): RouteCriticFindingsResult {
  actor = requireText(actor, "actor");
  const clock = options.clock ?? systemClock;
  const maxRepairRounds = options.maxRepairRounds ?? MAX_REPAIR_ROUNDS;
  const now = clock.now();

  const findings = generateStructuredFindingsFromCritic(reviewValue);
  const review = (
    typeof reviewValue === "object" && reviewValue !== null ? reviewValue : {}
  ) as Partial<CompletionReview>;

  const reviewStatus = review.status === "clean" ? "clean" : "findings";
  if (reviewStatus === "clean" || findings.length === 0) {
    return {
      reviewedStatus: reviewStatus,
      totalFindingsRouted: 0,
      affectedTaskIds: [],
      changesRequestedTaskIds: [],
      escalatedTaskIds: [],
      summaries: [],
    };
  }

  let result: RouteCriticFindingsResult = {
    reviewedStatus: "findings",
    totalFindingsRouted: 0,
    affectedTaskIds: [],
    changesRequestedTaskIds: [],
    escalatedTaskIds: [],
    summaries: [],
  };

  port.transact(
    actor,
    "critic-findings-routed",
    {
      actor,
      findings_count: findings.length,
      finding_ids: findings.map((f) => f.id),
    },
    (draft) => {
      const taskFindingsMap = new Map<string, Finding[]>();

      for (const finding of findings) {
        const targetTasks = findTasksForFinding(draft.tasks, finding);
        for (const task of targetTasks) {
          const list = taskFindingsMap.get(task.id) ?? [];
          list.push(finding);
          taskFindingsMap.set(task.id, list);
        }
      }

      const summaries: TaskRepairSummary[] = [];
      const changesRequestedTaskIds: string[] = [];
      const escalatedTaskIds: string[] = [];

      for (const [taskId, taskFindings] of taskFindingsMap.entries()) {
        const task = taskIn(draft, taskId);
        const priorStatus = task.status;

        const priorFindings = task.findings ? [...task.findings] : [];
        const isDeterministic = taskFindings.some((f) =>
          priorFindings.some(
            (prior) =>
              prior.id === f.id ||
              (prior.requirement_id === f.requirement_id &&
                prior.observation.trim().toLowerCase() === f.observation.trim().toLowerCase() &&
                prior.status === "open"),
          ),
        );

        task.findings ??= [];
        for (const f of taskFindings) {
          if (!task.findings.some((existing) => existing.id === f.id)) {
            task.findings.push({ ...f, status: "open" });
          }
        }

        task.repair_round = (task.repair_round ?? 0) + 1;
        const assignee = task.original_implementer ?? actor;
        task.repair_assignee = assignee;

        const exhausted = task.repair_round >= maxRepairRounds;
        const shouldEscalate = exhausted || isDeterministic;

        const newStatus = shouldEscalate ? "escalated" : "changes_requested";
        const reason = isDeterministic
          ? `deterministic defect repeated across repair attempts (${taskFindings.map((f) => f.id).join(", ")})`
          : exhausted
            ? `repair rounds exhausted (${task.repair_round}/${maxRepairRounds})`
            : `completeness critic requested changes (${taskFindings.map((f) => f.id).join(", ")})`;

        transition(task, newStatus, actor, now, reason);
        archiveOpenValidations(task);

        if (shouldEscalate) {
          escalatedTaskIds.push(taskId);
        } else {
          changesRequestedTaskIds.push(taskId);
        }

        summaries.push({
          taskId,
          priorStatus,
          newStatus,
          repairRound: task.repair_round,
          repairAssignee: assignee,
          assignedFindingsCount: taskFindings.length,
          isEscalated: shouldEscalate,
          ...(shouldEscalate ? { escalationReason: reason } : {}),
        });
      }

      result = {
        reviewedStatus: "findings",
        totalFindingsRouted: findings.length,
        affectedTaskIds: Array.from(taskFindingsMap.keys()).sort(),
        changesRequestedTaskIds: changesRequestedTaskIds.sort(),
        escalatedTaskIds: escalatedTaskIds.sort(),
        summaries,
      };
    },
  );

  return result;
}
