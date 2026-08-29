import { transact } from "../../../engine/store/index.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  DecideProposalOptions,
  MindProposal,
  ProposalAuthorityDecisionInput,
  TransitionProposalOptions,
} from "./types.ts";
import {
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
  PROPOSAL_WITNESS_OWNER_DECISION,
} from "./types.ts";
import { parseNowIso, getAllProposals } from "./storage.ts";
import { assertRoleMayDecideProposal } from "./validation.ts";
import { transitionProposalStatusInState } from "./transitions.ts";
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
