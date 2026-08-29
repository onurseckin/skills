import { recordProposalInState } from "./creation.ts";
import { transitionProposalStatusInState } from "./transitions.ts";
import { DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD } from "./types.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  GeneratePlanRevisionOptions,
  MindProposal,
  PlanRevisionApplicationResult,
  PlanRevisionProposal,
  PlanRevisionSignal,
  PlanRevisionTaskSpec,
  PlanRevisionType,
} from "./types.ts";
import { getAllProposals, parseNowIso } from "./storage.ts";
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
    const existing = getAllProposals(state).find(
      (p: MindProposal) => p.id === revision.targetProposalId,
    );
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
