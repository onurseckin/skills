import { describe, expect, test } from "bun:test";
import {
  DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_OPEN_PROPOSALS,
  DEFAULT_PROPOSAL_MIN_INTERVAL_MS,
  PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE,
  PROPOSAL_WITNESS_OWNER_DECISION,
  VALID_PROPOSAL_TRANSITIONS,
  admitProposalInState,
  advanceProposalWithInitiative,
  applyPlanRevisionInState,
  assertRoleMayDecideProposal,
  buildExactAnchorBriefing,
  buildWakeBrief,
  calculateProposalFingerprint,
  calculateRemainingCooldownMs,
  canTransitionProposal,
  checkProposalRateLimits,
  completeProposalInState,
  computeFullWakeBrief,
  createDropInAnchor,
  decideProposal,
  decideProposalInState,
  deriveLane,
  deriveRecommendedTestCommands,
  evaluateAdmissionGates,
  evaluateGate1Witnessed,
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
  evaluateGate5Affordable,
  evaluateGate6NotADuplicate,
  evaluateInitiativeTriggers,
  executeFalsifier,
  extractFileAnchors,
  extractFileSymbols,
  extractSymbolsFromSource,
  findAnchorByPattern,
  findCommandRecord,
  findDeclinedProposalConflict,
  formatDuration,
  formatExactAnchorBriefingMarkdown,
  formatNumber,
  formatPlanRevisionBrief,
  formatProposalBrief,
  formatShortSha,
  generatePlanRevisionFromSignals,
  getAllProposals,
  getDeclinedProposals,
  getGrantedProposals,
  getOpenProposals,
  isDuplicateProposal,
  isPathInRepoRoots,
  isProposalAdmissible,
  isProposalGranted,
  normalizeText,
  outputContainsDefect,
  parseFalsifierArgv,
  parseNowIso,
  parseNowMs,
  readCandidateCommandOutput,
  recordProposal,
  recordProposalInState,
  renderCharterLine,
  renderGapLine,
  renderHealthLine,
  renderIntegrityLine,
  renderRuntimeLine,
  transitionProposalStatusInState,
  type AdmissionEvaluationResult,
  type AdmissionGateVerdict,
  type AnchorOptions,
  type AnchorSymbol,
  type AnchorSymbolKind,
  type BuildWakeBriefOptions,
  type CandidateRecord,
  type CharterStatus,
  type CommandRecordCandidate,
  type DecideProposalOptions,
  type ExactAnchor,
  type ExactAnchorBriefing,
  type ExactAnchorBriefingOptions,
  type GateEvaluationContext,
  type GeneratePlanRevisionOptions,
  type HealthObservationSummary,
  type InitiativeActionType,
  type InitiativeEvaluationInput,
  type InitiativeEvaluationResult,
  type IntegrityStatus,
  type LiveRunSummary,
  type MindBriefFacts,
  type MindLane,
  type MindMode,
  type MindProposal,
  type PlanRevisionApplicationResult,
  type PlanRevisionProposal,
  type PlanRevisionSignal,
  type PlanRevisionSignalType,
  type PlanRevisionTaskSpec,
  type PlanRevisionType,
  type ProposalAuthorityDecisionInput,
  type ProposalRateLimitCheckResult,
  type ProposalStatus,
  type RecordProposalOptions,
  type RuntimeStatus,
  type TransitionProposalOptions,
  type WakeBriefResult,
} from "../../../olt/scripts/src/mind/proposals/index.ts";

describe("mind/proposals/index.ts - Barrel Facade Integrity", () => {
  test("exports all expected brief functions and formatters", () => {
    expect(typeof buildWakeBrief).toBe("function");
    expect(typeof computeFullWakeBrief).toBe("function");
    expect(typeof deriveLane).toBe("function");
    expect(typeof formatDuration).toBe("function");
    expect(typeof formatNumber).toBe("function");
    expect(typeof formatShortSha).toBe("function");
    expect(typeof renderCharterLine).toBe("function");
    expect(typeof renderGapLine).toBe("function");
    expect(typeof renderHealthLine).toBe("function");
    expect(typeof renderIntegrityLine).toBe("function");
    expect(typeof renderRuntimeLine).toBe("function");

    expect(formatDuration(5000)).toBe("5s");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatShortSha("abcdef1234567890")).toBe("abcd…890");
    expect(formatShortSha("abc")).toBe("abc");
  });

  test("exports all expected builder functions", () => {
    expect(typeof buildExactAnchorBriefing).toBe("function");
    expect(typeof createDropInAnchor).toBe("function");
    expect(typeof deriveRecommendedTestCommands).toBe("function");
    expect(typeof extractFileAnchors).toBe("function");
    expect(typeof extractFileSymbols).toBe("function");
    expect(typeof extractSymbolsFromSource).toBe("function");
    expect(typeof findAnchorByPattern).toBe("function");
    expect(typeof formatExactAnchorBriefingMarkdown).toBe("function");

    const anchor = createDropInAnchor("src/index.ts", 10, 20, "export const x = 1;");
    expect(anchor.filePath).toBe("src/index.ts");
    expect(anchor.startLine).toBe(10);
    expect(anchor.endLine).toBe(20);
    expect(anchor.replacementTarget).toBe("export const x = 1;");
  });

  test("exports all expected gate functions", () => {
    expect(typeof evaluateAdmissionGates).toBe("function");
    expect(typeof evaluateGate1Witnessed).toBe("function");
    expect(typeof evaluateGate2InCharter).toBe("function");
    expect(typeof evaluateGate3Falsifiable).toBe("function");
    expect(typeof evaluateGate4Scoped).toBe("function");
    expect(typeof evaluateGate5Affordable).toBe("function");
    expect(typeof evaluateGate6NotADuplicate).toBe("function");
    expect(typeof executeFalsifier).toBe("function");
    expect(typeof findCommandRecord).toBe("function");
    expect(typeof isPathInRepoRoots).toBe("function");
    expect(typeof outputContainsDefect).toBe("function");
    expect(typeof parseFalsifierArgv).toBe("function");
    expect(typeof readCandidateCommandOutput).toBe("function");

    expect(isPathInRepoRoots("src/mind/proposals.ts", ["src/"], "/repo")).toBe(true);
    expect(isPathInRepoRoots("external/file.ts", ["src/"], "/repo")).toBe(false);
    expect(outputContainsDefect("error: command failed")).toBe(true);
  });

  test("exports all expected proposal constants, validators, and lifecycle operations", () => {
    expect(DEFAULT_INITIATIVE_CONFIDENCE_THRESHOLD).toBe(0.85);
    expect(DEFAULT_MAX_OPEN_PROPOSALS).toBe(5);
    expect(DEFAULT_PROPOSAL_MIN_INTERVAL_MS).toBe(86400000);
    expect(PROPOSAL_WITNESS_AUTONOMOUS_INITIATIVE).toBe("autonomous-initiative");
    expect(PROPOSAL_WITNESS_OWNER_DECISION).toBe("owner-decision");
    expect(Array.isArray(VALID_PROPOSAL_TRANSITIONS.needs_authority)).toBe(true);

    expect(typeof admitProposalInState).toBe("function");
    expect(typeof advanceProposalWithInitiative).toBe("function");
    expect(typeof applyPlanRevisionInState).toBe("function");
    expect(typeof assertRoleMayDecideProposal).toBe("function");
    expect(typeof calculateProposalFingerprint).toBe("function");
    expect(typeof calculateRemainingCooldownMs).toBe("function");
    expect(typeof canTransitionProposal).toBe("function");
    expect(typeof checkProposalRateLimits).toBe("function");
    expect(typeof completeProposalInState).toBe("function");
    expect(typeof decideProposal).toBe("function");
    expect(typeof decideProposalInState).toBe("function");
    expect(typeof evaluateInitiativeTriggers).toBe("function");
    expect(typeof findDeclinedProposalConflict).toBe("function");
    expect(typeof formatPlanRevisionBrief).toBe("function");
    expect(typeof formatProposalBrief).toBe("function");
    expect(typeof generatePlanRevisionFromSignals).toBe("function");
    expect(typeof getAllProposals).toBe("function");
    expect(typeof getDeclinedProposals).toBe("function");
    expect(typeof getGrantedProposals).toBe("function");
    expect(typeof getOpenProposals).toBe("function");
    expect(typeof isDuplicateProposal).toBe("function");
    expect(typeof isProposalAdmissible).toBe("function");
    expect(typeof isProposalGranted).toBe("function");
    expect(typeof normalizeText).toBe("function");
    expect(typeof parseNowIso).toBe("function");
    expect(typeof parseNowMs).toBe("function");
    expect(typeof recordProposal).toBe("function");
    expect(typeof recordProposalInState).toBe("function");
    expect(typeof transitionProposalStatusInState).toBe("function");

    expect(normalizeText("  Foo   Bar  ")).toBe("foo bar");
    expect(canTransitionProposal("needs_authority", "granted")).toBe(true);
    expect(canTransitionProposal("granted", "needs_authority")).toBe(false);
  });

  test("type contracts compile and bind correctly through barrel", () => {
    const briefOpts: BuildWakeBriefOptions = {
      actor: "mind-1",
      mode: "idle",
      now: 1700000000000,
    };
    expect(briefOpts.actor).toBe("mind-1");

    const anchorSym: AnchorSymbol = {
      name: "deriveLane",
      kind: "function" as AnchorSymbolKind,
      startLine: 1,
      endLine: 10,
    };
    expect(anchorSym.name).toBe("deriveLane");

    const gateVerdict: AdmissionGateVerdict = "pass";
    expect(gateVerdict).toBe("pass");

    const proposalStatus: ProposalStatus = "needs_authority";
    expect(proposalStatus).toBe("needs_authority");

    const initiativeAction: InitiativeActionType = "create_proposal";
    expect(initiativeAction).toBe("create_proposal");

    const planRevSignalType: PlanRevisionSignalType = "stale_backlog";
    expect(planRevSignalType).toBe("stale_backlog");
  });
});
