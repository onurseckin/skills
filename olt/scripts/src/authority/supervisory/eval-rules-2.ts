import { validateAgentNamingConvention } from "../thread/index.ts";
import type {
  ActiveLeaseContext,
  PersonaViolation,
  SupervisoryReminderEvaluationContext,
} from "./types.ts";

export function evaluateRulesBatch2(
  role: string,
  tier: number,
  context: SupervisoryReminderEvaluationContext,
  leases: readonly ActiveLeaseContext[],
  violations: PersonaViolation[],
  correctiveDirectives: string[],
): void {
  const unprovenGatesCount = context.unprovenGatesCount ?? 0;
  if (tier === 2 && unprovenGatesCount > 0) {
    violations.push({
      code: "UNPROVEN_GATE_RISK",
      rule: "Compiled task gates must be proven to fail on disposable scratch copies before trusting them.",
      severity: "medium",
      message: `Found ${unprovenGatesCount} compiled gate(s) that have not been verified via \`gate:prove\`.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Identify the compiled gate that has not been verified.\n2. Create a disposable scratch copy of the gate scenario.\n3. Execute `gate:prove` to verify the gate can fail on negative defects.",
      evidence: { unprovenGatesCount },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Run `gate:prove` on compiled task gates.\n2. Record falsifiability evidence before accepting passes.",
    );
  }

  const qualitativePasses = context.qualitativePassesWithoutProof ?? [];
  if (tier <= 2 && qualitativePasses.length > 0) {
    violations.push({
      code: "QUALITATIVE_PASS_RUBBER_STAMP_BREACH",
      rule: "Supervisors must reject superficial or qualitative validator passes lacking quantitative metrics.",
      severity: "high",
      message: `Accepted ${qualitativePasses.length} validator pass(es) lacking quantitative proof metrics.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Review the unverified validator pass.\n2. Issue a `coordinator:pushback` requiring quantitative evidence.\n3. Mandate DOM bounds, APCA contrast, and screenshot proofs in the subsequent review round.",
      evidence: { qualitativePasses },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Execute `coordinator:pushback` against qualitative-only validator reports.\n2. Enforce explicit requirements for quantitative DOM/screenshot proof.",
    );
  }

  const uiTasksMissingViewports = context.uiTasksMissingViewportValidation ?? [];
  if (uiTasksMissingViewports.length > 0) {
    violations.push({
      code: "FOUR_TIER_VIEWPORT_MATRIX_BREACH",
      rule: "All UI/visual frontend tasks mandate multi-viewport verification (1920x1080, 1440x900, 768x1024, 390x844).",
      severity: "high",
      message: `${uiTasksMissingViewports.length} UI task(s) missing multi-viewport verification: ${uiTasksMissingViewports.join(", ")}.`,
      correctiveDirective:
        "**Resolution Path:**\n1. Identify the missing viewports for the UI task.\n2. Execute dual-channel visual validation captures across the required viewports (Desktop-Wide, Desktop, Tablet, Mobile).\n3. Attach the resulting screenshots and DOM metrics to the task evidence.",
      evidence: { uiTasksMissingViewports },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Run multi-viewport captures across all 4 tiers (1920x1080, 1440x900, 768x1024, 390x844).\n2. Mandate these captures for all visual UI tasks.",
    );
  }

  if (context.attemptedPrematureCompletion) {
    const hasBlockers =
      leases.length > 0 ||
      (context.openFindingsCount ?? 0) > 0 ||
      (context.failedGatesCount ?? 0) > 0 ||
      unprovenGatesCount > 0;

    if (hasBlockers) {
      violations.push({
        code: "PREMATURE_RUN_COMPLETION_BREACH",
        rule: "Never declare run completion with active leases, open findings, or unproven gates.",
        severity: "critical",
        message:
          "Attempted `run:complete` while active blockers, open findings, or unproven gates remain.",
        correctiveDirective:
          "**Resolution Path:**\n1. Halt the run completion attempt immediately.\n2. Check for active leases and wait for them to finish.\n3. Resolve all open findings and verify gates.\n4. Obtain sign-off from the completeness critic before proceeding.",
        evidence: {
          activeLeasesCount: leases.length,
          openFindingsCount: context.openFindingsCount,
          failedGatesCount: context.failedGatesCount,
        },
      });
      correctiveDirectives.push(
        "**Resolution Path:**\n1. Address all open findings.\n2. Validate that all wave gates pass.\n3. Declare run completion only when no blockers remain.",
      );
    }
  }

  if (role.startsWith("validator") && context.adversarialProbeRecorded === false) {
    violations.push({
      code: "MANDATORY_ADVERSARIAL_PROBE_OMISSION",
      rule: "Adversarial validators must record at least 1 probe demand (`task:probe`) before passing.",
      severity: "high",
      message:
        "Validator attempted or issued a review without recording a mandatory adversarial probe round.",
      correctiveDirective:
        "**Resolution Path:**\n1. Halt the pass review process.\n2. Execute `task:probe` demanding proof of edge cases or error handling.\n3. Verify the probe response before certifying the pass.",
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Record an adversarial probe demand with `task:probe`.\n2. Ensure a satisfactory response is provided before issuing a pass verdict.",
    );
  }

  if (context.agentId) {
    const namingValidation = validateAgentNamingConvention(context.agentId, role, tier);
    if (!namingValidation.valid) {
      const reasonDetail = namingValidation.reason ? `: ${namingValidation.reason}.` : ".";
      violations.push({
        code: "UNSTANDARDIZED_AGENT_ID_BREACH",
        rule: "All agents must use standardized role-prefixed and scope-bound IDs.",
        severity: "high",
        message: `Agent ID '${context.agentId}' violates standardized naming${reasonDetail}`,
        correctiveDirective: namingValidation.recommendedAgentId
          ? `**Resolution Path:**\n1. Terminate the agent with the non-compliant ID.\n2. Re-register the agent using the recommended standardized ID: ${namingValidation.recommendedAgentId}.`
          : "**Resolution Path:**\n1. Terminate the agent with the non-compliant ID.\n2. Re-register using a standardized agent ID (<role>_<task-id>-<slug> for Tier 3, <role>_<slug> for Tier 1/2).",
        evidence: {
          agentId: context.agentId,
          reasons: namingValidation.reason ? [namingValidation.reason] : [],
        },
      });
      correctiveDirectives.push(
        namingValidation.recommendedAgentId
          ? `**Resolution Path:**\n1. Adopt the recommended standardized agent ID: ${namingValidation.recommendedAgentId}.`
          : "**Resolution Path:**\n1. Review the agent naming conventions.\n2. Adopt a standardized agent ID for the role and tier.",
      );
    }
  }

  if (
    context.evidenceVerificationFailed ||
    (context.evidenceVerification && !context.evidenceVerification.certified)
  ) {
    const errorDetails =
      context.evidenceVerification?.errors.join("; ") ??
      "Milestone evidence failed cryptographic verification.";
    violations.push({
      code: "PROSE_EVIDENCE_BIAS_BREACH",
      rule: "Supervisors must mandate cryptographic event hash chains and exit_code === 0 command receipts instead of accepting prose assertions.",
      severity: "critical",
      message: `Milestone evidence verification failed: ${errorDetails}`,
      correctiveDirective:
        "**Resolution Path:**\n1. Inspect `events.jsonl` and ensure SHA-256 hash chain is unbroken from sequence 1 to tail.\n2. Ensure all required CLI commands have executed with exit_code === 0.\n3. Certify milestones strictly on cryptographic receipt proof.",
      evidence: {
        errors: context.evidenceVerification?.errors ?? ["Evidence verification failed."],
      },
    });
    correctiveDirectives.push(
      "**Resolution Path:**\n1. Re-verify SHA-256 event hash chain and CLI command receipts.\n2. Reject any milestone transition lacking cryptographic proof.",
    );
  }

  if (context.subagentIdleWarningCount && context.subagentIdleWarningCount > 0) {
    violations.push({
      code: "STRICT_TIER_HIERARCHY_IDLE_WARNING",
      rule: "Subagents should maintain continuous execution progress without prolonged idle stagnation.",
      severity: "low",
      message: `${context.subagentIdleWarningCount} subagent idle warning(s) detected.`,
      correctiveDirective: "Inspect subagent execution progress and nudge active leases.",
      evidence: { subagentIdleWarningCount: context.subagentIdleWarningCount },
    });
    correctiveDirectives.push("Inspect subagent execution progress and nudge active leases.");
  }
}
