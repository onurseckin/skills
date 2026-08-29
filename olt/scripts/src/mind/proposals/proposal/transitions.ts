import { PROPOSAL_WITNESS_OWNER_DECISION } from "./types.ts";
import { getAllProposals } from "./storage.ts";
import { createHash } from "node:crypto";
import { transact } from "../../../engine/store/index.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  MindProposal,
  ProposalStatus,
  RecordProposalOptions,
  TransitionProposalOptions,
} from "./types.ts";
import { canTransitionProposal, parseNowIso, isDuplicateProposal } from "./storage.ts";
import { recordProposalInState } from "./creation.ts";
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
