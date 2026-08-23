import { MAX_REPAIR_ROUNDS } from "../../core/config/constants.ts";
import type { Finding, TaskStatus } from "../../core/contracts/workflow.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { topologicalOrder, type DependencyMap } from "../../graph/topology.ts";
import { isInteger, isRecord } from "../../requirements/predicates.ts";
import { archiveOpenValidations } from "../../workflow/review/validation-state.ts";
import { requireText, taskIn, transition } from "../../workflow/task-state.ts";
import {
  systemClock,
  type Clock,
  type TaskRecord,
  type TransactionPort,
  type WorkflowState,
} from "../../workflow/types.ts";
import { assertHierarchicalCompliance, type AgentRoleHierarchy } from "./decision-tree.ts";

export type ReviewerRole = "completeness-critic" | "validator";

export interface CriticFindingInput {
  readonly id: string;
  readonly requirement_id: string;
  readonly severity?: "critical" | "important" | "minor" | undefined;
  readonly observation: string;
  readonly counterfactualRequirement?: string | undefined;
  readonly evidence?: readonly Record<string, unknown>[] | undefined;
  readonly remediation?: string | undefined;
  readonly revalidation?: string | undefined;
  readonly affectedFilePaths?: readonly string[] | undefined;
}

export interface CriticFindingDetail {
  readonly id: string;
  readonly requirement_id: string;
  readonly severity: "critical" | "important" | "minor";
  readonly observation: string;
  readonly counterfactualRequirement: string;
  readonly evidence: readonly Record<string, unknown>[];
  readonly remediation: string;
  readonly revalidation: string;
  readonly status: "open" | "resolved";
  readonly affectedFilePaths: readonly string[];
}

export type PairAssignmentStrategy = "same_author" | "replacement_pair";

export interface ImplementerValidatorBinding {
  readonly implementerId: string;
  readonly validatorId: string;
  readonly isReplacementPair: boolean;
}

export interface ClosedLoopRepairPayload {
  readonly taskId: string;
  readonly repairRound: number;
  readonly priorStatus: TaskStatus;
  readonly newStatus: "changes_requested" | "escalated";
  readonly binding: ImplementerValidatorBinding;
  readonly writeScope: readonly string[];
  readonly findings: readonly CriticFindingDetail[];
  readonly counterfactualRequirements: readonly string[];
  readonly revalidationGates: readonly string[];
  readonly repairDirectives: string;
  readonly isEscalated: boolean;
  readonly escalationReason?: string | undefined;
}

export interface CompiledRepairDagNode {
  readonly taskId: string;
  readonly role: "repairer";
  readonly tier: number;
  readonly status: TaskStatus;
  readonly repairRound: number;
  readonly assignee: string;
  readonly validatorAssignee: string;
  readonly writeScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly counterfactualRequirements: readonly string[];
  readonly revalidationCommand: string;
  readonly directives: string;
}

export interface CompiledRepairDag {
  readonly revision: number;
  readonly roundNumber: number;
  readonly nodes: readonly CompiledRepairDagNode[];
  readonly totalWork: number;
  readonly totalSpan: number;
  readonly parallelismFactor: number;
  readonly isAcyclic: boolean;
  readonly criticalPath: readonly string[];
  readonly dominatingDirectives: readonly string[];
}

export interface RouteCriticFeedbackOptions {
  readonly maxRepairRounds?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly pairStrategy?: PairAssignmentStrategy | undefined;
  readonly availableImplementers?: readonly string[] | undefined;
  readonly availableValidators?: readonly string[] | undefined;
  readonly defaultRevalidationCommand?: string | undefined;
  readonly graphRevision?: number | undefined;
}

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

/**
 * Derives a strong counterfactual requirement ensuring non-tautological repair.
 */
export function deriveCounterfactualRequirement(
  observation: string,
  remediation: string,
  explicitCounterfactual?: string,
): string {
  if (explicitCounterfactual && explicitCounterfactual.trim()) {
    return explicitCounterfactual.trim();
  }
  return `Counterfactual Requirement: Implementation must specifically resolve and prevent recurrence of: "${observation.trim()}". Concrete fix applied: "${remediation.trim()}".`;
}

/**
 * Normalizes raw critic findings into canonical CriticFindingDetail structures.
 */
export function normalizeCriticFinding(raw: unknown): CriticFindingDetail | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const requirement_id =
    typeof raw.requirement_id === "string"
      ? raw.requirement_id.trim()
      : typeof raw.req_id === "string"
        ? raw.req_id.trim()
        : "";
  const observation = typeof raw.observation === "string" ? raw.observation.trim() : "";
  const remediation = typeof raw.remediation === "string" ? raw.remediation.trim() : "";

  if (!id || !requirement_id || !observation || !remediation) {
    return null;
  }

  const rawSeverity = typeof raw.severity === "string" ? raw.severity.toLowerCase() : "important";
  const severity: "critical" | "important" | "minor" =
    rawSeverity === "critical" ? "critical" : rawSeverity === "minor" ? "minor" : "important";

  const counterfactual = deriveCounterfactualRequirement(
    observation,
    remediation,
    typeof raw.counterfactualRequirement === "string" ? raw.counterfactualRequirement : undefined,
  );

  const revalidation =
    typeof raw.revalidation === "string" && raw.revalidation.trim()
      ? raw.revalidation.trim()
      : typeof raw.gate === "string" && raw.gate.trim()
        ? raw.gate.trim()
        : `bun test tests/unit`;

  const affectedFilePaths: string[] = [];
  if (Array.isArray(raw.file_paths)) {
    for (const p of raw.file_paths) {
      if (typeof p === "string" && p.trim()) affectedFilePaths.push(p.trim());
    }
  } else if (Array.isArray(raw.affected_files)) {
    for (const p of raw.affected_files) {
      if (typeof p === "string" && p.trim()) affectedFilePaths.push(p.trim());
    }
  }

  const evidence: Record<string, unknown>[] = [];
  if (Array.isArray(raw.evidence)) {
    for (const e of raw.evidence) {
      if (isRecord(e)) evidence.push(e);
    }
  }

  return {
    id,
    requirement_id,
    severity,
    observation,
    counterfactualRequirement: counterfactual,
    evidence,
    remediation,
    revalidation,
    status: "open",
    affectedFilePaths,
  };
}

export function selectImplementerValidatorPair(
  task: TaskRecord,
  currentRound: number,
  strategy: PairAssignmentStrategy = "same_author",
  availableImplementers?: readonly string[] | undefined,
  availableValidators?: readonly string[] | undefined,
): ImplementerValidatorBinding {
  if (currentRound < 1) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `currentRound must be positive, got ${currentRound}`,
    );
  }
  const originalImplementer =
    typeof task.original_implementer === "string" ? task.original_implementer : "implementer-1";
  const originalValidator = "validator-1";

  if (strategy === "same_author") {
    const foundValidator =
      availableValidators && availableValidators.length > 0
        ? availableValidators.find((v) => v !== originalImplementer)
        : undefined;
    const validatorId =
      foundValidator !== undefined
        ? foundValidator
        : originalValidator === originalImplementer
          ? "validator-independent"
          : originalValidator;

    return {
      implementerId:
        typeof task.repair_assignee === "string" ? task.repair_assignee : originalImplementer,
      validatorId,
      isReplacementPair: false,
    };
  }

  // Replacement pair strategy: pick fresh implementer and independent validator
  const implementerPool = availableImplementers ?? ["implementer-repair-lead", "implementer-alt"];
  const validatorPool = availableValidators ?? ["validator-senior", "validator-independent"];

  const foundImp = implementerPool.find(
    (imp) => imp !== originalImplementer && imp !== task.repair_assignee,
  );
  const replacementImplementer =
    foundImp !== undefined
      ? foundImp
      : implementerPool[0] !== undefined
        ? implementerPool[0]
        : "implementer-replacement";

  const foundVal = validatorPool.find(
    (v) => v !== replacementImplementer && v !== originalImplementer,
  );
  const replacementValidator =
    foundVal !== undefined
      ? foundVal
      : validatorPool[0] !== undefined
        ? validatorPool[0]
        : "validator-replacement";

  return {
    implementerId: replacementImplementer,
    validatorId: replacementValidator,
    isReplacementPair: true,
  };
}

export function detectDeterministicRepeat(
  priorFindings: readonly Finding[] | undefined,
  newFinding: CriticFindingDetail,
): boolean {
  if (!priorFindings || priorFindings.length === 0) return false;
  return priorFindings.some(
    (prior) =>
      prior.id === newFinding.id ||
      (prior.requirement_id === newFinding.requirement_id &&
        prior.observation.trim().toLowerCase() === newFinding.observation.trim().toLowerCase() &&
        prior.status === "open"),
  );
}

function matchTasksForFinding(
  tasks: Record<string, TaskRecord>,
  finding: CriticFindingDetail,
): TaskRecord[] {
  const matched: TaskRecord[] = [];

  // Match by requirement_id
  for (const task of Object.values(tasks)) {
    if (task.requirement_ids.includes(finding.requirement_id)) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  // Match by affected file paths or write scope
  for (const task of Object.values(tasks)) {
    const hasPathMatch =
      finding.affectedFilePaths.some((p) => task.write_scope.includes(p)) ||
      task.write_scope.some(
        (scope) =>
          finding.observation.includes(scope) ||
          finding.remediation.includes(scope) ||
          finding.counterfactualRequirement.includes(scope),
      );
    if (hasPathMatch) {
      matched.push(task);
    }
  }
  if (matched.length > 0) return matched;

  // Fallback to active/repaired tasks
  const candidateTasks = Object.values(tasks).filter(
    (t) => t.status === "done" || t.status === "validated" || t.status === "changes_requested",
  );
  return candidateTasks.length > 0 ? [candidateTasks[0]!] : Object.values(tasks);
}

export function compileRepairDag(
  payloads: readonly ClosedLoopRepairPayload[],
  state: WorkflowState,
  roundNumber: number,
): CompiledRepairDag {
  const nodes: CompiledRepairDagNode[] = [];
  const dominatingDirectives: string[] = [];

  dominatingDirectives.push(
    `[DOMINATING REPAIR DAG COMPILATION — ROUND ${roundNumber}]`,
    "1. Strict Hierarchical Execution: Repairers must execute only within their leased write scope.",
    "2. Zero Scope Creep: Modification outside scoped write paths is blocked by Harness Doctor.",
    "3. Mandatory Counterfactual Proof: All revalidation gates must pass before submitting task.",
  );

  const depsMap: DependencyMap = new Map();
  const taskMap = new Map<string, { effort: number }>();

  for (const payload of payloads) {
    const task = state.tasks[payload.taskId];
    const taskDeps = task?.dependencies ?? [];
    depsMap.set(payload.taskId, new Set(taskDeps));
    taskMap.set(payload.taskId, {
      effort: isInteger(task?.effort) && task.effort > 0 ? task.effort : 1,
    });

    const revalCmd =
      payload.revalidationGates.length > 0
        ? payload.revalidationGates[0]!
        : `bun test --filter ${payload.taskId}`;

    nodes.push({
      taskId: payload.taskId,
      role: "repairer",
      tier: 2,
      status: payload.newStatus,
      repairRound: payload.repairRound,
      assignee: payload.binding.implementerId,
      validatorAssignee: payload.binding.validatorId,
      writeScope: [...payload.writeScope],
      dependencies: [...taskDeps],
      counterfactualRequirements: [...payload.counterfactualRequirements],
      revalidationCommand: revalCmd,
      directives: payload.repairDirectives,
    });
  }

  let isAcyclic = true;
  let criticalPath: string[] = [];
  let totalWork = 0;
  let totalSpan = 0;

  try {
    const order = topologicalOrder(depsMap);
    isAcyclic = order.length === depsMap.size;

    for (const id of depsMap.keys()) {
      totalWork += taskMap.get(id)?.effort ?? 1;
    }

    const cumulativeSpan = new Map<string, number>();
    const parentPath = new Map<string, string | null>();

    for (const taskId of order) {
      const effort = taskMap.get(taskId)?.effort ?? 1;
      const prereqs = depsMap.get(taskId) ?? new Set();
      let maxPrereq = 0;
      let bestP: string | null = null;
      for (const p of prereqs) {
        const s = cumulativeSpan.get(p) ?? 0;
        if (s > maxPrereq) {
          maxPrereq = s;
          bestP = p;
        }
      }
      cumulativeSpan.set(taskId, maxPrereq + effort);
      parentPath.set(taskId, bestP);
    }

    let maxSpan = 0;
    let endTask: string | null = null;
    for (const [id, span] of cumulativeSpan.entries()) {
      if (span > maxSpan) {
        maxSpan = span;
        endTask = id;
      }
    }

    let curr = endTask;
    while (curr !== null) {
      criticalPath.unshift(curr);
      curr = parentPath.get(curr) ?? null;
    }
    totalSpan = Math.max(1, maxSpan);
  } catch {
    isAcyclic = false;
    totalWork = Math.max(1, payloads.length);
    totalSpan = Math.max(1, payloads.length);
  }

  const work = Math.max(1, totalWork);
  const span = Math.max(1, totalSpan);
  const parallelismFactor = Number((work / span).toFixed(2));

  return {
    revision: (state.graph_revision ?? 1) + 1,
    roundNumber,
    nodes,
    totalWork: work,
    totalSpan: span,
    parallelismFactor,
    isAcyclic,
    criticalPath,
    dominatingDirectives,
  };
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
  options: RouteCriticFeedbackOptions = {},
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

  // Extract raw findings
  const rawList: unknown[] = [];
  let reviewStatus = "findings";

  if (Array.isArray(findingsInput)) {
    rawList.push(...findingsInput);
  } else if (isRecord(findingsInput)) {
    reviewStatus = findingsInput.status === "clean" ? "clean" : "findings";
    if (Array.isArray(findingsInput.findings)) {
      rawList.push(...findingsInput.findings);
    }
    // Handle unproven requirements as findings
    if (reviewStatus === "findings" && Array.isArray(findingsInput.requirement_proofs)) {
      for (const proof of findingsInput.requirement_proofs) {
        if (
          isRecord(proof) &&
          proof.status === "unproven" &&
          typeof proof.requirement_id === "string"
        ) {
          rawList.push({
            id: `UNPROVEN-REQ-${proof.requirement_id}`,
            requirement_id: proof.requirement_id,
            severity: "critical",
            observation: `Requirement ${proof.requirement_id} remains unproven in completeness review`,
            remediation: `Implement non-mocked automated validation proving requirement ${proof.requirement_id}`,
            revalidation: `bun test --filter ${proof.requirement_id}`,
          });
        }
      }
    }
  }

  const parsedFindings: CriticFindingDetail[] = [];
  for (const item of rawList) {
    const f = normalizeCriticFinding(item);
    if (f) parsedFindings.push(f);
  }

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

export function evaluateRepairCycleConvergence(state: WorkflowState): {
  readonly isConverged: boolean;
  readonly tasksInRepair: readonly string[];
  readonly escalatedTasks: readonly string[];
  readonly openFindingsCount: number;
} {
  const inRepair: string[] = [];
  const escalated: string[] = [];
  let openFindingsCount = 0;

  for (const task of Object.values(state.tasks)) {
    if (task.status === "changes_requested") {
      inRepair.push(task.id);
    } else if (task.status === "escalated") {
      escalated.push(task.id);
    }

    if (Array.isArray(task.findings)) {
      for (const f of task.findings) {
        if (f.status === "open") openFindingsCount += 1;
      }
    }
  }

  return {
    isConverged: inRepair.length === 0 && escalated.length === 0 && openFindingsCount === 0,
    tasksInRepair: inRepair.sort(),
    escalatedTasks: escalated.sort(),
    openFindingsCount,
  };
}
