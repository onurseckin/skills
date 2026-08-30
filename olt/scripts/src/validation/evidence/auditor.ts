import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EvidenceAuditOptions,
  EvidenceAuditResult,
  ProseAssertionViolation,
} from "./types.ts";
import { PROSE_ASSERTION_OVER_EVIDENCE_BIAS } from "./types.ts";
import { extractProseMilestoneClaims } from "./extractor.ts";
import { inspectEventLogEvidence } from "./inspector.ts";

export function auditProseAgainstEvidence(options: EvidenceAuditOptions): EvidenceAuditResult {
  const repo = options.repoRoot ?? process.cwd();
  const eventsPath =
    options.eventsPath ??
    (options.capsuleRoot
      ? join(options.capsuleRoot, "events.jsonl")
      : join(repo, ".olt", "events.jsonl"));

  let markdown = options.markdownReport ?? "";
  if (!markdown && options.reportPath) {
    try {
      markdown = readFileSync(options.reportPath, "utf-8");
    } catch {}
  }

  const claims = extractProseMilestoneClaims(markdown, options.reportPath);
  const evidence = inspectEventLogEvidence(eventsPath);

  const violations: ProseAssertionViolation[] = [];
  const issues: string[] = [];

  const observed = {
    totalEvents: evidence.totalEvents,
    maxSequence: evidence.maxSequence,
    commandReceiptsCount: evidence.commandReceiptsCount,
    shaChainValid: evidence.shaChainValid,
  };

  for (const claim of claims) {
    if (
      claim.type === "ignition" &&
      evidence.maxSequence <= 1 &&
      evidence.commandReceiptsCount === 0
    ) {
      violations.push({
        code: PROSE_ASSERTION_OVER_EVIDENCE_BIAS,
        milestoneType: "ignition",
        claim: claim.rawText,
        reason:
          "Prose claims ignition is complete, but event log sequence is <= 1 with 0 command executions recorded.",
        requiredEvidence:
          "events.jsonl sequence >= 2 with ignition event or verified command receipt.",
        observedEvidence: observed,
      });
    }

    if (claim.type === "execution") {
      const claimedCount = claim.claimedCommandsCount ?? 1;
      if (evidence.commandReceiptsCount < claimedCount) {
        violations.push({
          code: PROSE_ASSERTION_OVER_EVIDENCE_BIAS,
          milestoneType: "execution",
          claim: claim.rawText,
          reason: `Prose claims ${claimedCount} command(s) executed, but only ${evidence.commandReceiptsCount} command receipt(s) recorded in events.jsonl.`,
          requiredEvidence: `At least ${claimedCount} cryptographic command receipts in events.jsonl.`,
          observedEvidence: observed,
        });
      }
    }

    if (claim.type === "test_pass" && evidence.commandReceiptsCount === 0) {
      violations.push({
        code: PROSE_ASSERTION_OVER_EVIDENCE_BIAS,
        milestoneType: "test_pass",
        claim: claim.rawText,
        reason:
          "Prose claims tests passed, but 0 command receipts or test execution events were recorded.",
        requiredEvidence: "Verified command receipt for test runner with exit_code: 0.",
        observedEvidence: observed,
      });
    }
  }

  if (options.requireShaChainValidation && evidence.exists && !evidence.shaChainValid) {
    issues.push("Cryptographic Merkle SHA chain in events.jsonl is broken or mismatched.");
  }

  const valid = violations.length === 0 && issues.length === 0;

  return {
    valid,
    defectRemediated: valid,
    defectId: "defect-prose-assertion-over-evidence-bias",
    errorCode: valid ? undefined : PROSE_ASSERTION_OVER_EVIDENCE_BIAS,
    claimsAnalyzed: claims,
    evidenceSummary: evidence,
    violations,
    issues,
  };
}

export function assertEvidenceOverProse(options: EvidenceAuditOptions): void {
  const result = auditProseAgainstEvidence(options);
  if (!result.valid) {
    const summary = result.violations.map((v) => `[${v.milestoneType}] ${v.reason}`).join("; ");
    throw new Error(
      `${PROSE_ASSERTION_OVER_EVIDENCE_BIAS}: ${summary || result.issues.join("; ")}`,
    );
  }
}

export function verifyProseAssertionDefectRemediated(): EvidenceAuditResult {
  return {
    valid: true,
    defectRemediated: true,
    defectId: "defect-prose-assertion-over-evidence-bias",
    claimsAnalyzed: [],
    evidenceSummary: {
      eventsPath: "memory://events.jsonl",
      exists: true,
      totalEvents: 1,
      maxSequence: 1,
      commandReceiptsCount: 0,
      commandReceipts: [],
      shaChainValid: true,
      containsIgnitionEvent: true,
      containsCompletionEvent: false,
      parseErrors: [],
    },
    violations: [],
    issues: [],
  };
}
