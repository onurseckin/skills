import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
import { transact } from "../store/transaction.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";

export type ProposalStatus =
  | "opened"
  | "needs_authority"
  | "granted"
  | "admitted"
  | "in_progress"
  | "completed"
  | "declined"
  | "revised";

export const PROPOSAL_WITNESS_OWNER_DECISION = "owner-decision";
export const PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE = "autonomous-initiative";
export const DEFAULT_MAX_OPEN_PROPOSALS = DEFAULT_MIND_BUDGET.max_open_proposals ?? 5;
export const DEFAULT_PROPOSAL_MIN_INTERVAL_MS = 86_400_000; // 24 hours
export const DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD = 0.85;

export const VALID_PROPOSAL_TRANSITIONS: Readonly<
  Record<ProposalStatus, readonly ProposalStatus[]>
> = {
  opened: ["needs_authority", "admitted", "declined"],
  needs_authority: ["granted", "admitted", "declined"],
  granted: ["admitted", "declined", "revised"],
  admitted: ["in_progress", "completed", "declined", "revised"],
  in_progress: ["completed", "declined", "revised"],
  revised: ["needs_authority", "admitted", "in_progress", "declined"],
  completed: [],
  declined: [],
};

export interface MindProposal {
  readonly id: string;
  readonly kind: "proposal";
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly falsifier_argv?: readonly string[] | undefined;
  readonly falsifier_exit?: number | undefined;
  readonly write_scope: readonly string[];
  readonly status: ProposalStatus;
  readonly requirement_id: string;
  readonly disposition: "needs_authority" | "actionable" | "out_of_scope" | "completed";
  readonly witness?: string | null | undefined;
  readonly witness_command_id?: string | null | undefined;
  readonly created_at: string;
  readonly created_pulse?: number | string | undefined;
  readonly decided_at?: string | null | undefined;
  readonly decided_by?: string | null | undefined;
  readonly decline_reason?: string | null | undefined;
  readonly gate_failed?: string | null | undefined;
  readonly objective_run_id?: string | null | undefined;
  readonly evidence_class: "agent_reported";
  readonly fingerprint?: string | undefined;
  readonly revision_count?: number | undefined;
  readonly parent_proposal_id?: string | null | undefined;
  readonly autonomous_initiative?: boolean | undefined;
  readonly initiative_trigger_id?: string | null | undefined;
  readonly initiative_score?: number | undefined;
}

export interface RecordProposalOptions {
  readonly id?: string | undefined;
  readonly statement: string;
  readonly rationale: string;
  readonly charter_goal_ids: readonly string[];
  readonly falsifier_argv?: readonly string[] | undefined;
  readonly falsifier_exit?: number | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly actor: string;
  readonly pulseId?: string | number | undefined;
  readonly witness?: string | null | undefined;
  readonly witness_command_id?: string | null | undefined;
  readonly now?: number | Date | string | undefined;
  readonly maxOpenProposals?: number | undefined;
  readonly minIntervalMs?: number | undefined;
  readonly autonomousInitiative?: boolean | undefined;
  readonly initiativeTriggerId?: string | undefined;
  readonly initiativeScore?: number | undefined;
}

export interface ProposalRateLimitCheckResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly openCount: number;
  readonly maxOpen: number;
  readonly remainingCooldownMs?: number | undefined;
}

export interface ProposalAuthorityDecisionInput {
  readonly decision: "grant" | "decline";
  readonly rationale: string;
}

export interface DecideProposalOptions {
  readonly actorRole?: string | undefined;
  readonly now?: number | Date | string | undefined;
}

export interface TransitionProposalOptions {
  readonly actorRole?: string | undefined;
  readonly now?: number | Date | string | undefined;
  readonly rationale?: string | undefined;
  readonly witness?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly gateFailed?: string | undefined;
  readonly declineReason?: string | undefined;
}

export type PlanRevisionSignalType =
  | "TEST_REGRESSION"
  | "PERFORMANCE_DEGRADATION"
  | "COGNITIVE_OVERLOAD"
  | "DEFECT_SURGE"
  | "DORMANT_CRITERIA"
  | "QUIESCENCE_EVOLUTION"
  | "SCOPE_COLLISION"
  | "ORCHESTRATOR_BOTTLENECK";

export type PlanRevisionType =
  | "TASK_SPLIT"
  | "SCOPE_REFINEMENT"
  | "PRIORITY_ESCALATION"
  | "COORDINATOR_REORGANIZATION"
  | "DEPENDENCY_RESTRUCTURING"
  | "NEW_EVOLUTION_BRANCH";

export interface PlanRevisionSignal {
  readonly signalType: PlanRevisionSignalType;
  readonly source: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly evidence: string;
  readonly affectedWriteScopes: readonly string[];
  readonly charterGoalId: string;
  readonly detectedAt?: string | undefined;
  readonly metricValue?: number | undefined;
  readonly thresholdValue?: number | undefined;
}

export interface PlanRevisionTaskSpec {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly rationale: string;
  readonly dependencies?: readonly string[] | undefined;
  readonly priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND" | undefined;
}

export interface PlanRevisionProposal {
  readonly id: string;
  readonly targetProposalId?: string | undefined;
  readonly targetTaskId?: string | undefined;
  readonly revisionType: PlanRevisionType;
  readonly signal: PlanRevisionSignal;
  readonly proposedChanges: {
    readonly summary: string;
    readonly newTasks?: readonly PlanRevisionTaskSpec[] | undefined;
    readonly modifiedTaskIds?: readonly string[] | undefined;
    readonly revisedWriteScopes?: readonly string[] | undefined;
    readonly newPriority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND" | undefined;
    readonly recommendedCoordinators?: number | undefined;
  };
  readonly autonomousAdvancementEligible: boolean;
  readonly confidenceScore: number;
  readonly createdAt: string;
}

export interface GeneratePlanRevisionOptions {
  readonly now?: number | Date | string | undefined;
  readonly confidenceThreshold?: number | undefined;
  readonly maxRevisionsPerSignal?: number | undefined;
  readonly baseWriteScope?: readonly string[] | undefined;
}

export interface PlanRevisionApplicationResult {
  readonly revisionId: string;
  readonly applied: boolean;
  readonly updatedProposal?: MindProposal | undefined;
  readonly createdProposals: readonly MindProposal[];
  readonly summary: string;
  readonly appliedAt: string;
}

export type InitiativeActionType =
  | "AUTONOMOUS_ADMIT"
  | "AUTONOMOUS_SPLIT"
  | "AUTONOMOUS_ESCALATE"
  | "REQUIRES_HUMAN_AUTHORITY";

export interface InitiativeEvaluationInput {
  readonly proposal:
    | MindProposal
    | {
        readonly id?: string | undefined;
        readonly statement: string;
        readonly rationale: string;
        readonly charter_goal_ids: readonly string[];
        readonly write_scope?: readonly string[] | undefined;
        readonly category?: string | undefined;
      };
  readonly confidenceScore: number;
  readonly signals?: readonly PlanRevisionSignal[] | undefined;
  readonly charterProhibitions?: readonly string[] | undefined;
  readonly repoRoots?: readonly string[] | undefined;
  readonly confidenceThreshold?: number | undefined;
}

export interface InitiativeEvaluationResult {
  readonly canAdvanceAutonomously: boolean;
  readonly initiativeScore: number;
  readonly action: InitiativeActionType;
  readonly reason: string;
  readonly triggerId: string;
  readonly safetyChecks: {
    readonly withinRepoRoots: boolean;
    readonly avoidsProhibitions: boolean;
    readonly charterAligned: boolean;
    readonly confidenceThresholdMet: boolean;
    readonly notDeclined: boolean;
  };
}

function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function parseNowIso(nowInput?: number | Date | string): string {
  return new Date(parseNowMs(nowInput)).toISOString();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Calculates a unique fingerprint hash for a proposal based on statement, charter goals, and write scope.
 */
export function calculateProposalFingerprint(
  statement: string,
  charterGoalIds: readonly string[] = [],
  writeScope: readonly string[] = [],
): string {
  const normStatement = normalizeText(statement);
  const normGoals = [...charterGoalIds]
    .map((g) => g.trim().toLowerCase())
    .sort()
    .join(",");
  const normScope = [...writeScope]
    .map((s) => s.trim().toLowerCase())
    .sort()
    .join(",");
  const hash = createHash("sha256")
    .update(`${normStatement}|${normGoals}|${normScope}`)
    .digest("hex");
  return `fp-${hash.slice(0, 12)}`;
}

/**
 * Checks whether a proposed change is a duplicate of an existing proposal in state.
 */
export function isDuplicateProposal(
  state: Record<string, unknown>,
  statement: string,
  charterGoalIds: readonly string[] = [],
  writeScope: readonly string[] = [],
): {
  readonly isDuplicate: boolean;
  readonly existingProposal?: MindProposal | undefined;
  readonly reason?: string | undefined;
} {
  const normTarget = normalizeText(statement);
  const targetFingerprint = calculateProposalFingerprint(statement, charterGoalIds, writeScope);
  const all = getAllProposals(state);

  // 1. Exact statement match against active/open proposals
  const openMatch = all.find(
    (p) =>
      (p.status === "needs_authority" ||
        p.status === "opened" ||
        p.status === "admitted" ||
        p.status === "in_progress") &&
      (normalizeText(p.statement) === normTarget || p.fingerprint === targetFingerprint),
  );
  if (openMatch) {
    return {
      isDuplicate: true,
      existingProposal: openMatch,
      reason: `duplicate active proposal '${openMatch.id}' with status '${openMatch.status}' already exists for: "${statement}"`,
    };
  }

  // 2. Declined match
  const declinedMatch = all.find(
    (p) => p.status === "declined" && normalizeText(p.statement) === normTarget,
  );
  if (declinedMatch) {
    return {
      isDuplicate: true,
      existingProposal: declinedMatch,
      reason: `proposal matches previously declined proposal '${declinedMatch.id}'`,
    };
  }

  return { isDuplicate: false };
}

/**
 * Verifies if a lifecycle transition between two proposal statuses is permitted.
 */
export function canTransitionProposal(from: ProposalStatus, to: ProposalStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_PROPOSAL_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Extracts all proposals recorded in capsule state.
 */
export function getAllProposals(state: Record<string, unknown>): MindProposal[] {
  const mindState = (state.mind ?? {}) as Record<string, unknown>;
  const list: Record<string, unknown>[] = [];

  if (Array.isArray(state.candidates)) {
    list.push(...(state.candidates as Record<string, unknown>[]));
  }
  if (Array.isArray(mindState.candidates)) {
    for (const item of mindState.candidates as Record<string, unknown>[]) {
      if (!list.some((existing) => existing.id === item.id)) {
        list.push(item);
      }
    }
  }

  return list
    .filter(
      (c) =>
        c.kind === "proposal" ||
        c.disposition === "needs_authority" ||
        c.status === "needs_authority" ||
        c.status === "opened" ||
        c.status === "granted" ||
        c.status === "admitted" ||
        c.status === "in_progress" ||
        c.status === "completed" ||
        c.status === "declined" ||
        c.status === "revised",
    )
    .map((c) => {
      const id = typeof c.id === "string" ? c.id : "cand-proposal";
      const statement = typeof c.statement === "string" ? c.statement : "";
      const rationale = typeof c.rationale === "string" ? c.rationale : "";
      const charterGoalIds = Array.isArray(c.charter_goal_ids)
        ? (c.charter_goal_ids as string[])
        : Array.isArray(c.charter_goals)
          ? (c.charter_goals as string[])
          : typeof c.charter_goal === "string"
            ? [c.charter_goal]
            : [];
      const falsifierArgv = Array.isArray(c.falsifier_argv)
        ? (c.falsifier_argv as string[])
        : undefined;
      const falsifierExit = typeof c.falsifier_exit === "number" ? c.falsifier_exit : undefined;
      const writeScope = Array.isArray(c.write_scope) ? (c.write_scope as string[]) : [];

      const rawStatus = typeof c.status === "string" ? c.status : "";
      let status: ProposalStatus = "needs_authority";
      if (
        rawStatus === "opened" ||
        rawStatus === "needs_authority" ||
        rawStatus === "granted" ||
        rawStatus === "admitted" ||
        rawStatus === "in_progress" ||
        rawStatus === "completed" ||
        rawStatus === "declined" ||
        rawStatus === "revised"
      ) {
        status = rawStatus;
      } else if (c.disposition === "actionable") {
        status = "granted";
      } else if (c.disposition === "out_of_scope") {
        status = "declined";
      }

      const requirementId = typeof c.requirement_id === "string" ? c.requirement_id : `req-${id}`;
      const disposition =
        c.disposition === "actionable" ||
        c.disposition === "out_of_scope" ||
        c.disposition === "completed"
          ? c.disposition
          : "needs_authority";
      const witness = typeof c.witness === "string" ? c.witness : null;
      const witnessCommandId =
        typeof c.witness_command_id === "string" ? c.witness_command_id : null;
      const createdAt = typeof c.created_at === "string" ? c.created_at : new Date(0).toISOString();
      const createdPulse =
        typeof c.created_pulse === "number" || typeof c.created_pulse === "string"
          ? c.created_pulse
          : undefined;
      const decidedAt = typeof c.decided_at === "string" ? c.decided_at : null;
      const decidedBy = typeof c.decided_by === "string" ? c.decided_by : null;
      const declineReason = typeof c.decline_reason === "string" ? c.decline_reason : null;
      const gateFailed = typeof c.gate_failed === "string" ? c.gate_failed : null;
      const objectiveRunId = typeof c.objective_run_id === "string" ? c.objective_run_id : null;
      const fingerprint =
        typeof c.fingerprint === "string"
          ? c.fingerprint
          : calculateProposalFingerprint(statement, charterGoalIds, writeScope);
      const revisionCount = typeof c.revision_count === "number" ? c.revision_count : 0;
      const parentProposalId =
        typeof c.parent_proposal_id === "string" ? c.parent_proposal_id : null;
      const autonomousInitiative = Boolean(c.autonomous_initiative);
      const initiativeTriggerId =
        typeof c.initiative_trigger_id === "string" ? c.initiative_trigger_id : null;
      const initiativeScore =
        typeof c.initiative_score === "number" ? c.initiative_score : undefined;

      const proposal: MindProposal = {
        id,
        kind: "proposal",
        statement,
        rationale,
        charter_goal_ids: charterGoalIds,
        falsifier_argv: falsifierArgv,
        falsifier_exit: falsifierExit,
        write_scope: writeScope,
        status,
        requirement_id: requirementId,
        disposition,
        witness,
        witness_command_id: witnessCommandId,
        created_at: createdAt,
        created_pulse: createdPulse,
        decided_at: decidedAt,
        decided_by: decidedBy,
        decline_reason: declineReason,
        gate_failed: gateFailed,
        objective_run_id: objectiveRunId,
        evidence_class: "agent_reported",
        fingerprint,
        revision_count: revisionCount,
        parent_proposal_id: parentProposalId,
        autonomous_initiative: autonomousInitiative,
        initiative_trigger_id: initiativeTriggerId,
        initiative_score: initiativeScore,
      };
      return proposal;
    });
}

/**
 * Returns all active proposals awaiting owner or autonomous decision.
 */
export function getOpenProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter(
    (p) => p.status === "needs_authority" || p.status === "opened",
  );
}

/**
 * Returns all permanently declined proposals.
 */
export function getDeclinedProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter((p) => p.status === "declined");
}

/**
 * Returns all granted proposals awaiting admission.
 */
export function getGrantedProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter((p) => p.status === "granted" || p.status === "admitted");
}

/**
 * Computes remaining cooldown in milliseconds for proposal generation.
 */
export function calculateRemainingCooldownMs(
  state: Record<string, unknown>,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly minIntervalMs?: number | undefined;
  } = {},
): number {
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const minInterval =
    options.minIntervalMs ??
    (typeof budget.proposal_interval_ms === "number"
      ? budget.proposal_interval_ms
      : DEFAULT_PROPOSAL_MIN_INTERVAL_MS);

  if (minInterval <= 0) return 0;

  const nowMs = parseNowMs(options.now);
  const allProposals = getAllProposals(state);
  let minRemaining = 0;

  for (const prop of allProposals) {
    const createdAtMs = Date.parse(prop.created_at);
    if (Number.isFinite(createdAtMs) && nowMs >= createdAtMs && nowMs - createdAtMs < minInterval) {
      const remaining = minInterval - (nowMs - createdAtMs);
      if (remaining > minRemaining) {
        minRemaining = remaining;
      }
    }
  }

  return minRemaining;
}

/**
 * Validates proposal rate limits and ceiling against state and budget.
 */
export function checkProposalRateLimits(
  state: Record<string, unknown>,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly pulseId?: string | number | undefined;
    readonly minIntervalMs?: number | undefined;
    readonly maxOpenProposals?: number | undefined;
  } = {},
): ProposalRateLimitCheckResult {
  const budget = (state.budget ?? {}) as Record<string, unknown>;
  const maxOpen =
    options.maxOpenProposals ??
    (typeof budget.max_open_proposals === "number"
      ? budget.max_open_proposals
      : DEFAULT_MAX_OPEN_PROPOSALS);

  const openProposals = getOpenProposals(state);
  const openCount = openProposals.length;

  if (openCount >= maxOpen) {
    return {
      allowed: false,
      reason: `open proposal ceiling reached (${openCount}/${maxOpen}); cannot open new proposal until pending proposals receive an owner authority decision`,
      openCount,
      maxOpen,
    };
  }

  // 1 proposal per pulse limit
  if (options.pulseId !== undefined) {
    const allProposals = getAllProposals(state);
    const existingInPulse = allProposals.some(
      (p) => String(p.created_pulse) === String(options.pulseId),
    );
    if (existingInPulse) {
      return {
        allowed: false,
        reason: `proposal rate limit exceeded: a proposal has already been recorded in pulse ${options.pulseId} (limit: at most 1 proposal per pulse)`,
        openCount,
        maxOpen,
      };
    }
  }

  // Time-based rate limit / cooldown
  const remainingCooldown = calculateRemainingCooldownMs(state, options);
  if (remainingCooldown > 0) {
    const remainingHours = (remainingCooldown / 3_600_000).toFixed(1);
    return {
      allowed: false,
      reason: `proposal rate limit exceeded: at most 1 proposal per cooldown window (next proposal eligible in ${remainingHours}h)`,
      openCount,
      maxOpen,
      remainingCooldownMs: remainingCooldown,
    };
  }

  return {
    allowed: true,
    openCount,
    maxOpen,
    remainingCooldownMs: 0,
  };
}

/**
 * Checks whether a proposal matches a previously declined proposal (Gate 6 duplicate/declined check).
 */
export function findDeclinedProposalConflict(
  state: Record<string, unknown>,
  statement: string,
): MindProposal | undefined {
  const normTarget = normalizeText(statement);
  const declined = getDeclinedProposals(state);
  return declined.find((p) => normalizeText(p.statement) === normTarget);
}

/**
 * Asserts that the role contract allows authority:decide. Mind agents and subagents are strictly prohibited.
 */
export function assertRoleMayDecideProposal(role: string, actor: string): void {
  if (role === "mind") {
    throw new HarnessError(
      "INVALID_STATE",
      `role mind may not invoke authority:decide: agent ${actor} holds a mind grant and cannot self-approve proposals`,
    );
  }
}

/**
 * Records a novelty proposal in the state draft.
 */
export function recordProposalInState(
  state: Record<string, unknown>,
  options: RecordProposalOptions,
): MindProposal {
  if (!options.statement || typeof options.statement !== "string" || !options.statement.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "proposal statement must be a non-empty string");
  }
  if (!options.rationale || typeof options.rationale !== "string" || !options.rationale.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "proposal rationale must be a non-empty string");
  }
  if (!Array.isArray(options.charter_goal_ids) || options.charter_goal_ids.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "proposal must cite at least one charter goal id");
  }

  // A standard proposal is defined by having NO witness upon creation (unless recorded via autonomous initiative)
  if (!options.autonomousInitiative) {
    if (
      options.witness !== undefined &&
      options.witness !== null &&
      String(options.witness).trim() !== ""
    ) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "proposals must not include a witness; novelty proposals require owner authority instead of a defect witness",
      );
    }
    if (
      options.witness_command_id !== undefined &&
      options.witness_command_id !== null &&
      String(options.witness_command_id).trim() !== ""
    ) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "proposals must not include a witness command id; novelty proposals require owner authority instead of a defect witness",
      );
    }
  }

  const statement = options.statement.trim();
  const rationale = options.rationale.trim();
  const writeScope = options.write_scope ? [...options.write_scope] : [];

  // Gate 6 check: declined proposal permanently blocked from re-proposal
  const declinedMatch = findDeclinedProposalConflict(state, statement);
  if (declinedMatch) {
    const reasonText = declinedMatch.decline_reason
      ? ` (reason: ${declinedMatch.decline_reason})`
      : "";
    throw new HarnessError(
      "INVALID_STATE",
      `declined proposal permanently blocked from re-proposal: "${statement}"${reasonText}`,
    );
  }

  // Duplicate check
  const duplicateCheck = isDuplicateProposal(
    state,
    statement,
    options.charter_goal_ids,
    writeScope,
  );
  if (duplicateCheck.isDuplicate) {
    throw new HarnessError(
      "INVALID_STATE",
      duplicateCheck.reason ?? `duplicate proposal already pending: "${statement}"`,
    );
  }

  // Rate limit and ceiling checks
  const rateLimitCheck = checkProposalRateLimits(state, {
    now: options.now,
    pulseId: options.pulseId,
    minIntervalMs: options.minIntervalMs,
    maxOpenProposals: options.maxOpenProposals,
  });

  if (!rateLimitCheck.allowed) {
    throw new HarnessError("INVALID_STATE", rateLimitCheck.reason!);
  }

  const nowIso = parseNowIso(options.now);
  const fingerprint = calculateProposalFingerprint(statement, options.charter_goal_ids, writeScope);
  const hashSeed = `${statement}:${nowIso}`;
  const candidateId =
    options.id ?? `cand-prop-${createHash("sha256").update(hashSeed).digest("hex").slice(0, 8)}`;
  const requirementId = `req-${candidateId}`;

  const initialStatus: ProposalStatus = options.autonomousInitiative
    ? "admitted"
    : "needs_authority";
  const initialDisposition = options.autonomousInitiative ? "actionable" : "needs_authority";
  const witness = options.autonomousInitiative
    ? (options.witness ??
      `${PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE}:${options.initiativeTriggerId ?? "trigger"}`)
    : null;
  const witnessCommandId = options.autonomousInitiative
    ? (options.witness_command_id ??
      `${PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE}:${options.initiativeTriggerId ?? "trigger"}`)
    : null;

  const proposal: MindProposal = {
    id: candidateId,
    kind: "proposal",
    statement,
    rationale,
    charter_goal_ids: [...options.charter_goal_ids],
    falsifier_argv: options.falsifier_argv ? [...options.falsifier_argv] : undefined,
    falsifier_exit: options.falsifier_exit,
    write_scope: writeScope,
    status: initialStatus,
    requirement_id: requirementId,
    disposition: initialDisposition,
    witness,
    witness_command_id: witnessCommandId,
    created_at: nowIso,
    created_pulse: options.pulseId,
    decided_at: options.autonomousInitiative ? nowIso : null,
    decided_by: options.autonomousInitiative ? options.actor : null,
    decline_reason: null,
    gate_failed: null,
    evidence_class: "agent_reported",
    fingerprint,
    revision_count: 0,
    parent_proposal_id: null,
    autonomous_initiative: options.autonomousInitiative,
    initiative_trigger_id: options.initiativeTriggerId,
    initiative_score: options.initiativeScore,
  };

  // Append to candidates list
  if (!Array.isArray(state.candidates)) {
    state.candidates = [];
  }
  (state.candidates as unknown[]).push(proposal);

  // Append to requirements list
  const reqRecord: Record<string, unknown> = {
    id: requirementId,
    statement,
    instruction: statement,
    rationale,
    disposition: initialDisposition,
    authority_status: options.autonomousInitiative ? "granted" : undefined,
    charter_goal: options.charter_goal_ids[0],
    charter_goals: [...options.charter_goal_ids],
    candidate_id: candidateId,
    created_at: nowIso,
  };

  if (Array.isArray(state.requirements)) {
    (state.requirements as unknown[]).push(reqRecord);
  } else if (
    typeof state.requirements === "object" &&
    state.requirements !== null &&
    Array.isArray((state.requirements as Record<string, unknown>).requirements)
  ) {
    ((state.requirements as Record<string, unknown>).requirements as unknown[]).push(reqRecord);
  } else {
    state.requirements = [reqRecord];
  }

  return proposal;
}

/**
 * Records a novelty proposal durably in a mind capsule via transaction.
 */
export function recordProposal(runRoot: string, options: RecordProposalOptions): MindProposal {
  let created: MindProposal | null = null;
  transact(
    runRoot,
    options.actor,
    "mind-candidate-opened",
    {
      candidate_id: options.id ?? "pending",
      kind: "proposal",
      statement: options.statement,
      rationale: options.rationale,
      charter_goal_ids: options.charter_goal_ids as string[],
      write_scope: (options.write_scope ?? []) as string[],
    },
    (state) => {
      created = recordProposalInState(state, options);
    },
  );

  return created!;
}

/**
 * Transitions an existing proposal to a new lifecycle status with validation.
 */
export function transitionProposalStatusInState(
  state: Record<string, unknown>,
  proposalOrReqId: string,
  newStatus: ProposalStatus,
  actor: string,
  options: TransitionProposalOptions = {},
): MindProposal {
  if (!proposalOrReqId || typeof proposalOrReqId !== "string" || !proposalOrReqId.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "proposal or requirement id must be specified");
  }

  const targetId = proposalOrReqId.trim();
  const candidates = Array.isArray(state.candidates)
    ? (state.candidates as Record<string, unknown>[])
    : [];

  const candidate = candidates.find((c) => c.id === targetId || c.requirement_id === targetId);
  if (!candidate) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown proposal or requirement: ${targetId}`);
  }

  const currentStatus: ProposalStatus =
    candidate.status === "opened" ||
    candidate.status === "needs_authority" ||
    candidate.status === "granted" ||
    candidate.status === "admitted" ||
    candidate.status === "in_progress" ||
    candidate.status === "completed" ||
    candidate.status === "declined" ||
    candidate.status === "revised"
      ? (candidate.status as ProposalStatus)
      : "needs_authority";

  if (!canTransitionProposal(currentStatus, newStatus)) {
    throw new HarnessError(
      "INVALID_STATE",
      `illegal proposal lifecycle transition from '${currentStatus}' to '${newStatus}' for proposal '${String(candidate.id)}'`,
    );
  }

  const nowIso = parseNowIso(options.now);

  candidate.status = newStatus;
  if (newStatus === "granted" || newStatus === "admitted") {
    candidate.disposition = "actionable";
    candidate.witness = options.witness ?? PROPOSAL_WITNESS_OWNER_DECISION;
    candidate.witness_command_id = options.witnessCommandId ?? PROPOSAL_WITNESS_OWNER_DECISION;
    candidate.decided_at = nowIso;
    candidate.decided_by = actor;
  } else if (newStatus === "in_progress") {
    candidate.disposition = "actionable";
  } else if (newStatus === "completed") {
    candidate.disposition = "completed";
  } else if (newStatus === "declined") {
    candidate.disposition = "out_of_scope";
    candidate.decline_reason =
      options.declineReason ?? options.rationale ?? "Declined by authority";
    candidate.decided_at = nowIso;
    candidate.decided_by = actor;
  } else if (newStatus === "revised") {
    const currentRevisions =
      typeof candidate.revision_count === "number" ? candidate.revision_count : 0;
    candidate.revision_count = currentRevisions + 1;
  }

  if (options.gateFailed) {
    candidate.gate_failed = options.gateFailed;
  }

  // Update corresponding requirement record if present
  const reqList: Record<string, unknown>[] = Array.isArray(state.requirements)
    ? (state.requirements as Record<string, unknown>[])
    : typeof state.requirements === "object" &&
        state.requirements !== null &&
        Array.isArray((state.requirements as Record<string, unknown>).requirements)
      ? ((state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[])
      : [];

  const requirement = reqList.find(
    (r) => r.id === candidate.requirement_id || r.id === candidate.id,
  );

  if (requirement) {
    if (newStatus === "granted" || newStatus === "admitted") {
      requirement.authority_status = "granted";
      requirement.disposition = "actionable";
    } else if (newStatus === "declined") {
      requirement.authority_status = "declined";
      requirement.disposition = "out_of_scope";
    } else if (newStatus === "completed") {
      requirement.disposition = "completed";
    }
  }

  const allUpdated = getAllProposals(state);
  return allUpdated.find((p) => p.id === candidate.id)!;
}

/**
 * Admits a proposal into actionable execution state.
 */
export function admitProposalInState(
  state: Record<string, unknown>,
  proposalOrReqId: string,
  actor: string,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly witness?: string | undefined;
  } = {},
): MindProposal {
  return transitionProposalStatusInState(state, proposalOrReqId, "admitted", actor, {
    now: options.now,
    witness: options.witness ?? PROPOSAL_WITNESS_OWNER_DECISION,
  });
}

/**
 * Completes a proposal that has satisfied all gates and deliverables.
 */
export function completeProposalInState(
  state: Record<string, unknown>,
  proposalOrReqId: string,
  actor: string,
  options: {
    readonly now?: number | Date | string | undefined;
    readonly rationale?: string | undefined;
  } = {},
): MindProposal {
  return transitionProposalStatusInState(state, proposalOrReqId, "completed", actor, {
    now: options.now,
    rationale: options.rationale,
  });
}

/**
 * Decides a pending proposal by authority: grant or decline.
 */
export function decideProposalInState(
  state: Record<string, unknown>,
  proposalOrReqId: string,
  actor: string,
  input: ProposalAuthorityDecisionInput,
  options: DecideProposalOptions = {},
): MindProposal {
  if (!proposalOrReqId || typeof proposalOrReqId !== "string" || !proposalOrReqId.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "proposal or requirement id must be specified");
  }
  if (input.decision !== "grant" && input.decision !== "decline") {
    throw new HarnessError("INVALID_ARGUMENT", "decision must be grant or decline");
  }
  if (!input.rationale || typeof input.rationale !== "string" || !input.rationale.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "decision rationale must be a non-empty string");
  }

  if (options.actorRole) {
    assertRoleMayDecideProposal(options.actorRole, actor);
  }

  const targetId = proposalOrReqId.trim();
  const candidates = Array.isArray(state.candidates)
    ? (state.candidates as Record<string, unknown>[])
    : [];

  const candidate = candidates.find((c) => c.id === targetId || c.requirement_id === targetId);

  if (!candidate) {
    throw new HarnessError("INVALID_ARGUMENT", `unknown proposal or requirement: ${targetId}`);
  }

  if (
    candidate.status !== "needs_authority" &&
    candidate.disposition !== "needs_authority" &&
    candidate.status !== "open" &&
    candidate.status !== "opened" &&
    candidate.status !== "proposed"
  ) {
    throw new HarnessError(
      "INVALID_STATE",
      `proposal ${String(candidate.id)} is not pending authority (status: ${String(candidate.status)})`,
    );
  }

  const nowIso = parseNowIso(options.now);
  const rationale = input.rationale.trim();

  // Update requirement record
  const reqList: Record<string, unknown>[] = Array.isArray(state.requirements)
    ? (state.requirements as Record<string, unknown>[])
    : typeof state.requirements === "object" &&
        state.requirements !== null &&
        Array.isArray((state.requirements as Record<string, unknown>).requirements)
      ? ((state.requirements as Record<string, unknown>).requirements as Record<string, unknown>[])
      : [];

  const requirement = reqList.find(
    (r) => r.id === candidate.requirement_id || r.id === candidate.id,
  );

  if (requirement) {
    requirement.authority_status = input.decision === "grant" ? "granted" : "declined";
    requirement.disposition = input.decision === "grant" ? "actionable" : "out_of_scope";
    requirement.authority_history = [
      {
        decision_id: `auth-${candidate.id}`,
        requirement_id: requirement.id,
        decision: input.decision,
        actor,
        rationale,
        decided_at: nowIso,
        prior_disposition: "needs_authority",
        resulting_disposition: input.decision === "grant" ? "actionable" : "out_of_scope",
      },
    ];
  }

  if (input.decision === "grant") {
    candidate.status = "granted";
    candidate.disposition = "actionable";
    candidate.witness = PROPOSAL_WITNESS_OWNER_DECISION;
    candidate.witness_command_id = PROPOSAL_WITNESS_OWNER_DECISION;
    candidate.decided_at = nowIso;
    candidate.decided_by = actor;
    candidate.rationale = rationale;
  } else {
    candidate.status = "declined";
    candidate.disposition = "out_of_scope";
    candidate.decline_reason = rationale;
    candidate.decided_at = nowIso;
    candidate.decided_by = actor;
  }

  const allUpdated = getAllProposals(state);
  return allUpdated.find((p) => p.id === candidate.id)!;
}

/**
 * Decides a proposal durably in a mind capsule via transaction.
 */
export function decideProposal(
  runRoot: string,
  proposalOrReqId: string,
  actor: string,
  input: ProposalAuthorityDecisionInput,
  options: DecideProposalOptions = {},
): MindProposal {
  let updated: MindProposal | null = null;
  transact(
    runRoot,
    actor,
    "mind-candidate-decided",
    {
      proposal_or_requirement_id: proposalOrReqId,
      decision: input.decision,
      rationale: input.rationale,
    },
    (state) => {
      updated = decideProposalInState(state, proposalOrReqId, actor, input, options);
    },
  );

  return updated!;
}

/**
 * Returns whether a proposal has been granted by authority.
 */
export function isProposalGranted(proposal: MindProposal): boolean {
  return (
    proposal.status === "granted" &&
    (proposal.witness === PROPOSAL_WITNESS_OWNER_DECISION ||
      proposal.witness_command_id === PROPOSAL_WITNESS_OWNER_DECISION ||
      (typeof proposal.witness === "string" &&
        proposal.witness.startsWith(PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE)))
  );
}

/**
 * Returns whether a granted proposal is now admissible for admission gates.
 */
export function isProposalAdmissible(proposal: MindProposal): boolean {
  return (
    (proposal.status === "granted" || proposal.status === "admitted") &&
    proposal.disposition === "actionable"
  );
}

/**
 * Generates dynamic plan revision proposals from incoming evolutionary signals.
 */
export function generatePlanRevisionFromSignals(
  signals: readonly PlanRevisionSignal[],
  options: GeneratePlanRevisionOptions = {},
): readonly PlanRevisionProposal[] {
  const revisions: PlanRevisionProposal[] = [];
  const nowIso = parseNowIso(options.now);
  const threshold = options.confidenceThreshold ?? DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD;
  const maxPerSignal = options.maxRevisionsPerSignal ?? 3;

  for (const signal of signals) {
    let revisionType: PlanRevisionType = "SCOPE_REFINEMENT";
    let autonomousEligible = false;
    let confidence = 0.9;
    const scopes =
      signal.affectedWriteScopes.length > 0
        ? signal.affectedWriteScopes
        : (options.baseWriteScope ?? ["olt/scripts/src/mind"]);

    switch (signal.signalType) {
      case "TEST_REGRESSION":
        revisionType = "TASK_SPLIT";
        autonomousEligible = true;
        confidence = 0.95;
        break;
      case "COGNITIVE_OVERLOAD":
        revisionType = "COORDINATOR_REORGANIZATION";
        autonomousEligible = true;
        confidence = 0.88;
        break;
      case "DEFECT_SURGE":
        revisionType = "PRIORITY_ESCALATION";
        autonomousEligible = true;
        confidence = 0.92;
        break;
      case "SCOPE_COLLISION":
        revisionType = "SCOPE_REFINEMENT";
        autonomousEligible = true;
        confidence = 0.94;
        break;
      case "ORCHESTRATOR_BOTTLENECK":
        revisionType = "COORDINATOR_REORGANIZATION";
        autonomousEligible = true;
        confidence = 0.9;
        break;
      case "QUIESCENCE_EVOLUTION":
      case "DORMANT_CRITERIA":
      case "PERFORMANCE_DEGRADATION":
      default:
        revisionType = "NEW_EVOLUTION_BRANCH";
        autonomousEligible = confidence >= threshold;
        break;
    }

    const revisionId = `rev-${signal.signalType.toLowerCase().replace(/_/g, "-")}-${Date.now().toString().slice(-6)}`;
    const newTasks: PlanRevisionTaskSpec[] = [];

    if (revisionType === "TASK_SPLIT") {
      newTasks.push(
        {
          id: `task-split-isolation-${Date.now().toString().slice(-4)}`,
          label: `Isolate regression in ${signal.source}`,
          write_scope: scopes,
          gate: "bun test",
          charter_goals: [signal.charterGoalId],
          rationale: `Remediate test regression detected in ${signal.source}: ${signal.evidence}`,
          priority: "CRITICAL",
        },
        {
          id: `task-split-hardening-${Date.now().toString().slice(-4)}`,
          label: `Harden test invariants for ${signal.source}`,
          write_scope: scopes,
          gate: "bun test",
          charter_goals: [signal.charterGoalId],
          rationale: `Establish regression barrier for ${signal.source}`,
          priority: "HIGH",
        },
      );
    } else if (revisionType === "NEW_EVOLUTION_BRANCH") {
      newTasks.push({
        id: `task-evo-branch-${Date.now().toString().slice(-4)}`,
        label: `Evolve ${signal.source} for ${signal.signalType}`,
        write_scope: scopes,
        gate: "bun test",
        charter_goals: [signal.charterGoalId],
        rationale: `Evolution branch triggered by ${signal.signalType}: ${signal.evidence}`,
        priority: signal.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
      });
    }

    revisions.push({
      id: revisionId,
      revisionType,
      signal,
      proposedChanges: {
        summary: `Dynamic plan revision [${revisionType}] triggered by ${signal.signalType} from ${signal.source}`,
        newTasks: newTasks.length > 0 ? newTasks : undefined,
        revisedWriteScopes: scopes,
        newPriority: signal.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
        recommendedCoordinators: revisionType === "COORDINATOR_REORGANIZATION" ? 2 : undefined,
      },
      autonomousAdvancementEligible: autonomousEligible && confidence >= threshold,
      confidenceScore: confidence,
      createdAt: nowIso,
    });

    if (revisions.length >= maxPerSignal * signals.length) {
      break;
    }
  }

  return revisions;
}

/**
 * Applies a plan revision directly to state, synthesizing new proposal or tasks.
 */
export function applyPlanRevisionInState(
  state: Record<string, unknown>,
  revision: PlanRevisionProposal,
  actor: string,
): PlanRevisionApplicationResult {
  const createdProposals: MindProposal[] = [];
  const nowIso = revision.createdAt;

  if (revision.proposedChanges.newTasks && revision.proposedChanges.newTasks.length > 0) {
    for (const taskSpec of revision.proposedChanges.newTasks) {
      const proposal = recordProposalInState(state, {
        id: `cand-${taskSpec.id}`,
        statement: taskSpec.label,
        rationale: taskSpec.rationale,
        charter_goal_ids: taskSpec.charter_goals,
        write_scope: taskSpec.write_scope,
        actor,
        now: nowIso,
        autonomousInitiative: revision.autonomousAdvancementEligible,
        initiativeTriggerId: revision.id,
        initiativeScore: revision.confidenceScore,
      });
      createdProposals.push(proposal);
    }
  }

  let updatedProposal: MindProposal | undefined;
  if (revision.targetProposalId) {
    const existing = getAllProposals(state).find((p) => p.id === revision.targetProposalId);
    if (existing) {
      updatedProposal = transitionProposalStatusInState(
        state,
        revision.targetProposalId,
        "revised",
        actor,
        { now: nowIso, rationale: revision.proposedChanges.summary },
      );
    }
  }

  return {
    revisionId: revision.id,
    applied: true,
    updatedProposal,
    createdProposals,
    summary: `Applied plan revision ${revision.id} (${revision.revisionType}): generated ${createdProposals.length} task proposal(s).`,
    appliedAt: nowIso,
  };
}

/**
 * Evaluates initiative triggers to determine if an agent or Mind subsystem can advance a proposal autonomously.
 */
export function evaluateInitiativeTriggers(
  input: InitiativeEvaluationInput,
  state?: Record<string, unknown>,
): InitiativeEvaluationResult {
  const confidence = input.confidenceScore;
  const threshold = input.confidenceThreshold ?? DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD;
  const triggerId = `init-trig-${createHash("sha256").update(input.proposal.statement).digest("hex").slice(0, 8)}`;

  const statement = input.proposal.statement;
  const scopes = input.proposal.write_scope ?? [];

  // Check 1: Declined check
  let notDeclined = true;
  if (state) {
    const declinedConflict = findDeclinedProposalConflict(state, statement);
    if (declinedConflict) {
      notDeclined = false;
    }
  }

  // Check 2: Within repo roots
  let withinRepoRoots = true;
  if (input.repoRoots && input.repoRoots.length > 0) {
    withinRepoRoots = scopes.every((scope) =>
      input.repoRoots!.some((root) => scope.startsWith(root) || scope.includes(root)),
    );
  }

  // Check 3: Avoids prohibitions (e.g. destructive actions, secrets, git push, direct contract edits)
  const normStatement = statement.toLowerCase();
  const destructiveKeywords = [
    "git push",
    "rm -rf",
    "delete database",
    "drop table",
    "publish package",
    "modify charter",
  ];
  let avoidsProhibitions = !destructiveKeywords.some((kw) => normStatement.includes(kw));

  if (input.charterProhibitions && input.charterProhibitions.length > 0) {
    if (input.charterProhibitions.some((proh) => normStatement.includes(proh.toLowerCase()))) {
      avoidsProhibitions = false;
    }
  }

  // Check 4: Charter alignment
  const charterAligned = input.proposal.charter_goal_ids.length > 0;

  // Check 5: Confidence threshold
  const confidenceThresholdMet = confidence >= threshold;

  const canAdvance =
    notDeclined &&
    withinRepoRoots &&
    avoidsProhibitions &&
    charterAligned &&
    confidenceThresholdMet;

  let action: InitiativeActionType = "REQUIRES_HUMAN_AUTHORITY";
  let reason = "Requires human authority decision";

  if (canAdvance) {
    action = "AUTONOMOUS_ADMIT";
    reason = `Autonomous initiative trigger qualified: confidence ${(confidence * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(1)}%, safe charter-bounded scope`;
  } else if (!avoidsProhibitions) {
    action = "REQUIRES_HUMAN_AUTHORITY";
    reason =
      "Proposal involves potentially sensitive or prohibited actions; mandatory human authority required";
  } else if (!notDeclined) {
    action = "REQUIRES_HUMAN_AUTHORITY";
    reason = "Proposal matches a previously declined proposal; cannot advance autonomously";
  } else if (!confidenceThresholdMet) {
    action = "REQUIRES_HUMAN_AUTHORITY";
    reason = `Initiative confidence ${(confidence * 100).toFixed(1)}% is below autonomous threshold ${(threshold * 100).toFixed(1)}%`;
  }

  return {
    canAdvanceAutonomously: canAdvance,
    initiativeScore: confidence,
    action,
    reason,
    triggerId,
    safetyChecks: {
      withinRepoRoots,
      avoidsProhibitions,
      charterAligned,
      confidenceThresholdMet,
      notDeclined,
    },
  };
}

/**
 * Autonomously advances a proposal to admitted status using verified initiative triggers.
 */
export function advanceProposalWithInitiative(
  state: Record<string, unknown>,
  proposalOrReqId: string,
  actor: string,
  evaluation: InitiativeEvaluationResult,
): MindProposal {
  if (!evaluation.canAdvanceAutonomously) {
    throw new HarnessError(
      "INVALID_STATE",
      `cannot advance proposal with initiative: ${evaluation.reason}`,
    );
  }

  return transitionProposalStatusInState(state, proposalOrReqId, "admitted", actor, {
    witness: `${PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE}:${evaluation.triggerId}`,
    witnessCommandId: `${PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE}:${evaluation.triggerId}`,
    rationale: evaluation.reason,
  });
}

/**
 * Formats proposal into a clean markdown brief.
 */
export function formatProposalBrief(proposal: MindProposal): string {
  const goalStr = proposal.charter_goal_ids.join(", ");
  const statusStr = proposal.status.toUpperCase();
  const lines = [
    `### Proposal: \`${proposal.id}\``,
    `- **Status**: ${statusStr}`,
    `- **Statement**: "${proposal.statement}"`,
    `- **Rationale**: ${proposal.rationale}`,
    `- **Charter Goals**: ${goalStr}`,
    `- **Requirement ID**: \`${proposal.requirement_id}\``,
    `- **Witness**: ${proposal.witness ?? "none (awaiting owner authority)"}`,
  ];
  if (proposal.decided_at && proposal.decided_by) {
    lines.push(`- **Decided By**: \`${proposal.decided_by}\` at ${proposal.decided_at}`);
  }
  if (proposal.decline_reason) {
    lines.push(`- **Decline Reason**: ${proposal.decline_reason}`);
  }
  if (proposal.autonomous_initiative) {
    lines.push(
      `- **Autonomous Initiative**: Trigger \`${proposal.initiative_trigger_id}\` (Score: ${proposal.initiative_score ?? "N/A"})`,
    );
  }
  return lines.join("\n");
}

/**
 * Formats plan revision into a markdown brief.
 */
export function formatPlanRevisionBrief(revision: PlanRevisionProposal): string {
  const lines = [
    `### Plan Revision: \`${revision.id}\``,
    `- **Type**: \`${revision.revisionType}\``,
    `- **Signal**: \`${revision.signal.signalType}\` (Severity: ${revision.signal.severity})`,
    `- **Confidence**: ${(revision.confidenceScore * 100).toFixed(1)}%`,
    `- **Autonomous Eligible**: ${revision.autonomousAdvancementEligible ? "YES" : "NO"}`,
    `- **Summary**: ${revision.proposedChanges.summary}`,
  ];
  if (revision.proposedChanges.newTasks && revision.proposedChanges.newTasks.length > 0) {
    lines.push("", "#### Generated Tasks:");
    for (const task of revision.proposedChanges.newTasks) {
      lines.push(`- **${task.id}**: ${task.label} (${task.priority ?? "MEDIUM"})`);
    }
  }
  return lines.join("\n");
}
