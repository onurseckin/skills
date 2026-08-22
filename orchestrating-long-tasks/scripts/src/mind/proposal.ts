import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
import { transact } from "../store/transaction.ts";
import { DEFAULT_MIND_BUDGET } from "./charter.ts";

export type ProposalStatus = "needs_authority" | "granted" | "declined" | "admitted";

export const PROPOSAL_WITNESS_OWNER_DECISION = "owner-decision";
export const DEFAULT_MAX_OPEN_PROPOSALS = DEFAULT_MIND_BUDGET.max_open_proposals ?? 5;
export const DEFAULT_PROPOSAL_MIN_INTERVAL_MS = 86_400_000; // 24 hours

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
  readonly disposition: "needs_authority" | "actionable" | "out_of_scope";
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
}

export interface ProposalRateLimitCheckResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly openCount: number;
  readonly maxOpen: number;
}

export interface ProposalAuthorityDecisionInput {
  readonly decision: "grant" | "decline";
  readonly rationale: string;
}

export interface DecideProposalOptions {
  readonly actorRole?: string | undefined;
  readonly now?: number | Date | string | undefined;
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
        c.status === "needs_authority",
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
      const status: ProposalStatus =
        c.status === "granted" || c.status === "declined" || c.status === "admitted"
          ? c.status
          : "needs_authority";
      const requirementId = typeof c.requirement_id === "string" ? c.requirement_id : `req-${id}`;
      const disposition =
        c.disposition === "actionable" || c.disposition === "out_of_scope"
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
      };
      return proposal;
    });
}

/**
 * Returns all active proposals awaiting owner decision.
 */
export function getOpenProposals(state: Record<string, unknown>): MindProposal[] {
  return getAllProposals(state).filter((p) => p.status === "needs_authority");
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

  // Time-based rate limit (e.g. 24 hours or budget configured)
  const minInterval =
    options.minIntervalMs ??
    (typeof budget.proposal_interval_ms === "number"
      ? budget.proposal_interval_ms
      : DEFAULT_PROPOSAL_MIN_INTERVAL_MS);

  if (minInterval > 0) {
    const nowMs = parseNowMs(options.now);
    const allProposals = getAllProposals(state);
    for (const prop of allProposals) {
      const createdAtMs = Date.parse(prop.created_at);
      if (
        Number.isFinite(createdAtMs) &&
        nowMs >= createdAtMs &&
        nowMs - createdAtMs < minInterval
      ) {
        const remainingMs = minInterval - (nowMs - createdAtMs);
        const remainingHours = (remainingMs / 3_600_000).toFixed(1);
        return {
          allowed: false,
          reason: `proposal rate limit exceeded: at most 1 proposal per 24 hours (next proposal eligible in ${remainingHours}h)`,
          openCount,
          maxOpen,
        };
      }
    }
  }

  return {
    allowed: true,
    openCount,
    maxOpen,
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

  // A proposal is defined by having NO witness upon creation
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

  const statement = options.statement.trim();
  const rationale = options.rationale.trim();

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

  // Duplicate open check
  const openProposals = getOpenProposals(state);
  const openMatch = openProposals.find(
    (p) => normalizeText(p.statement) === normalizeText(statement),
  );
  if (openMatch) {
    throw new HarnessError(
      "INVALID_STATE",
      `duplicate open proposal '${openMatch.id}' already pending authority decision: "${statement}"`,
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
  const hashSeed = `${statement}:${nowIso}`;
  const candidateId =
    options.id ?? `cand-prop-${createHash("sha256").update(hashSeed).digest("hex").slice(0, 8)}`;
  const requirementId = `req-${candidateId}`;

  const proposal: MindProposal = {
    id: candidateId,
    kind: "proposal",
    statement,
    rationale,
    charter_goal_ids: [...options.charter_goal_ids],
    falsifier_argv: options.falsifier_argv ? [...options.falsifier_argv] : undefined,
    falsifier_exit: options.falsifier_exit,
    write_scope: options.write_scope ? [...options.write_scope] : [],
    status: "needs_authority",
    requirement_id: requirementId,
    disposition: "needs_authority",
    witness: null,
    witness_command_id: null,
    created_at: nowIso,
    created_pulse: options.pulseId,
    decided_at: null,
    decided_by: null,
    decline_reason: null,
    gate_failed: null,
    evidence_class: "agent_reported",
  };

  // Append to candidates list
  if (!Array.isArray(state.candidates)) {
    state.candidates = [];
  }
  (state.candidates as unknown[]).push(proposal);

  // Append to requirements list as needs_authority
  const reqRecord: Record<string, unknown> = {
    id: requirementId,
    statement,
    instruction: statement,
    rationale,
    disposition: "needs_authority",
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
      proposal.witness_command_id === PROPOSAL_WITNESS_OWNER_DECISION)
  );
}

/**
 * Returns whether a granted proposal is now admissible for admission gates.
 */
export function isProposalAdmissible(proposal: MindProposal): boolean {
  return isProposalGranted(proposal) && proposal.disposition === "actionable";
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
  return lines.join("\n");
}
