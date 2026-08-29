import { transitionProposalStatusInState } from "./transitions.ts";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  InitiativeActionType,
  InitiativeEvaluationInput,
  InitiativeEvaluationResult,
  MindProposal,
  PlanRevisionProposal,
} from "./types.ts";
import {
  DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD,
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
} from "./types.ts";
import { parseNowIso } from "./storage.ts";
import { findDeclinedProposalConflict } from "./validation.ts";
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
