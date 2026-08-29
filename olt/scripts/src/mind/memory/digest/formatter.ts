import type {
  DigestDeclinedCandidate,
  DigestEscalation,
  DigestFailingGate,
  DigestFinding,
  DigestOpenProposal,
  EscalationDigestData,
  FormatDigestOptions,
} from "./types.ts";

export function formatCitation(options: {
  readonly commandSource?: string | undefined;
  readonly witnessCommandId?: string | undefined;
  readonly eventIndex?: number | undefined;
}): string {
  const parts: string[] = [];
  const cmd = options.witnessCommandId ?? options.commandSource;
  if (cmd) {
    parts.push(options.witnessCommandId ? `witness: \`${cmd}\`` : `source: \`${cmd}\``);
  }
  if (typeof options.eventIndex === "number") {
    parts.push(`event: #${options.eventIndex}`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function formatFindingLine(f: DigestFinding): string {
  const taskPart = f.taskId ? ` (task \`${f.taskId}\`)` : f.runId ? ` (run \`${f.runId}\`)` : "";
  const severityPart = f.severity ? ` [${f.severity}]` : "";
  const remPart = f.remediation ? ` — Remediation: ${f.remediation}` : "";
  const revalPart = f.revalidationGate ? ` — Revalidation: \`${f.revalidationGate}\`` : "";
  const citation = formatCitation({ commandSource: f.commandSource, eventIndex: f.eventIndex });
  return `  - \`[${f.findingId}]\`${severityPart}${taskPart}: ${f.observation}${remPart}${revalPart}${citation}`;
}

export function formatGateLine(g: DigestFailingGate): string {
  const cmdStr = Array.isArray(g.command) ? g.command.join(" ") : String(g.command);
  const taskPart = g.taskId ? ` (task \`${g.taskId}\`)` : g.runId ? ` (run \`${g.runId}\`)` : "";
  const exitPart = typeof g.exitCode === "number" ? ` (exit code ${g.exitCode})` : "";
  const snippetPart = g.failureSnippet ? ` — ${g.failureSnippet}` : "";
  const citation = formatCitation({ commandSource: g.commandSource, eventIndex: g.eventIndex });
  return `  - \`${g.gateId}\`${taskPart}: \`${cmdStr}\`${exitPart}${snippetPart}${citation}`;
}

export function formatEscalationLine(e: DigestEscalation): string {
  const taskPart = e.taskId ? ` (task \`${e.taskId}\`)` : e.runId ? ` (run \`${e.runId}\`)` : "";
  const evPart = e.evidence ? ` — ${e.evidence}` : "";
  const citation = formatCitation({ commandSource: e.commandSource, eventIndex: e.eventIndex });
  return `  - \`${e.escalationId}\`${taskPart}: ${e.reason}${evPart}${citation}`;
}

export function formatDeclinedCandidateLine(c: DigestDeclinedCandidate): string {
  const meta: string[] = [];
  if (c.charterGoalId) meta.push(`goal: \`${c.charterGoalId}\``);
  const cmd = c.witnessCommandId ?? c.commandSource;
  if (cmd) meta.push(`witness: \`${cmd}\``);
  if (typeof c.eventIndex === "number") meta.push(`event: #${c.eventIndex}`);
  const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  return `  - \`${c.candidateId}\`: "${c.statement}" — Reason: ${c.declineReason}${metaStr}`;
}

export function formatOpenProposalLine(p: DigestOpenProposal): string {
  const meta: string[] = [];
  if (p.charterGoalId) meta.push(`goal: \`${p.charterGoalId}\``);
  if (p.requirementId) meta.push(`requirement: \`${p.requirementId}\``);
  if (p.commandSource) meta.push(`source: \`${p.commandSource}\``);
  if (typeof p.eventIndex === "number") meta.push(`event: #${p.eventIndex}`);
  const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  return `  - \`${p.proposalId}\`: "${p.statement}" — Rationale: ${p.rationale}${metaStr}`;
}

export function formatOwnerDigestMarkdown(
  digest: EscalationDigestData,
  options: FormatDigestOptions = {},
): string {
  const title = options.title ?? "Owner Digest";
  const explicitEmptyUnasked = options.explicitEmptyUnasked ?? true;
  const includeTrailingValueSeries = options.includeTrailingValueSeries ?? true;

  const hasUnasked = digest.declinedCandidates.length > 0 || digest.openProposals.length > 0;

  const unaskedLines: string[] = [];
  if (!hasUnasked && explicitEmptyUnasked) {
    unaskedLines.push("No unasked actions or proposals in this period.");
  } else {
    unaskedLines.push(`- **Declined candidates**: ${digest.declinedCandidates.length}`);
    if (digest.declinedCandidates.length === 0) {
      unaskedLines.push("  - none");
    } else {
      unaskedLines.push(...digest.declinedCandidates.map(formatDeclinedCandidateLine));
    }
    unaskedLines.push(
      `- **Open proposals (needs authority decision)**: ${digest.openProposals.length}`,
    );
    if (digest.openProposals.length === 0) {
      unaskedLines.push("  - none");
    } else {
      unaskedLines.push(...digest.openProposals.map(formatOpenProposalLine));
    }
  }

  const trailing = digest.trailingValueSeries;
  const trailingLines: string[] = [];
  if (includeTrailingValueSeries && trailing) {
    trailingLines.push(
      "",
      "## Trailing value series",
      "",
      `- **Raw series**: \`${trailing.formattedSeries}\``,
      `- **Total value**: ${trailing.totalValue}`,
      `- **Trailing zero streak**: ${trailing.trailingZeroStreak}`,
    );
    if (trailing.isFlatZero && trailing.rawValues.length >= 5) {
      trailingLines.push(
        `> ⚠️ **Flat Zero Series**: All ${trailing.rawValues.length} recent pulses produced 0 value. A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.`,
      );
    }
  }

  const lines: string[] = [
    `### ${title}: \`${digest.runId}\``,
    `- **Generated**: ${digest.generatedAt}`,
    `- **Open findings**: ${digest.openFindings.length}`,
    ...(digest.openFindings.length === 0
      ? ["  - none"]
      : digest.openFindings.map(formatFindingLine)),
    `- **Failing gates**: ${digest.failingGates.length}`,
    ...(digest.failingGates.length === 0 ? ["  - none"] : digest.failingGates.map(formatGateLine)),
    `- **Escalations (needs human decision)**: ${digest.escalations.length}`,
    ...(digest.escalations.length === 0
      ? ["  - none"]
      : digest.escalations.map(formatEscalationLine)),
    "",
    "## What I would have done without asking",
    "",
    ...unaskedLines,
    ...trailingLines,
  ];

  return lines.join("\n");
}

export function formatEscalationDigestMarkdown(
  digest: EscalationDigestData,
  options: FormatDigestOptions = {},
): string {
  const title = options.title ?? "Escalation Digest";
  const explicitEmptyUnasked = options.explicitEmptyUnasked ?? false;
  const includeTrailing =
    options.includeTrailingValueSeries ??
    (digest.trailingValueSeries !== undefined && digest.trailingValueSeries.rawValues.length > 0);

  return formatOwnerDigestMarkdown(digest, {
    title,
    explicitEmptyUnasked,
    includeTrailingValueSeries: includeTrailing,
  });
}

export function formatMemoryDigestMarkdown(
  digest: EscalationDigestData,
  options: FormatDigestOptions = {},
): string {
  return formatOwnerDigestMarkdown(digest, options);
}
