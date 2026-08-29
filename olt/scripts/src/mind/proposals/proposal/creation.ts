import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import type { MindProposal, ProposalStatus, RecordProposalOptions } from "./types.ts";
import {
  PROPOSAL_WITNESS_OWNER_DECISION,
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
} from "./types.ts";
import { parseNowIso, calculateProposalFingerprint, isDuplicateProposal } from "./storage.ts";
import { checkProposalRateLimits, findDeclinedProposalConflict } from "./validation.ts";
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
