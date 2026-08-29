import { join } from "node:path";
import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import type { MindProposal, ProposalStatus } from "./types.ts";
import { VALID_PROPOSAL_TRANSITIONS } from "./types.ts";
export function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function parseNowIso(nowInput?: number | Date | string): string {
  return new Date(parseNowMs(nowInput)).toISOString();
}

export function normalizeText(value: string): string {
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
