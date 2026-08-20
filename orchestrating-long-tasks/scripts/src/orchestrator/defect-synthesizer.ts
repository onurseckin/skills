import type { EvidenceClass } from "../contracts/evidence.ts";
import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { Finding } from "../contracts/workflow.ts";
import type { DefectSynthesis, CriticDecision, RoundGateResult } from "./types.ts";

/**
 * A finding carrying the provenance of its file list. Paths a finding declared are facts; paths
 * recovered from its prose are inference, and the synthesized prompt says which it is reading.
 */
export interface NormalizedFinding extends FindingDetail {
  readonly file_paths_evidence_class: EvidenceClass;
}

export interface SynthesizeDefectsInput {
  readonly roundNumber: number;
  readonly priorRunId: string;
  readonly originalPrompt: string;
  readonly findings?: readonly (Finding | FindingDetail)[] | undefined;
  readonly criticDecision?: CriticDecision | undefined;
  readonly criticFeedback?: string | undefined;
  readonly gateResults?: readonly RoundGateResult[] | undefined;
  readonly gateFailures?: readonly string[] | undefined;
}

function isFindingDetail(finding: Finding | FindingDetail): finding is FindingDetail {
  return (
    "file_paths" in finding &&
    Array.isArray(finding.file_paths) &&
    finding.file_paths.every((p) => typeof p === "string")
  );
}

export function normalizeFindingToDetail(finding: Finding | FindingDetail): NormalizedFinding {
  if (isFindingDetail(finding)) {
    return {
      id: finding.id,
      requirement_id: finding.requirement_id,
      severity: finding.severity,
      file_paths: finding.file_paths,
      file_paths_evidence_class: "agent_reported",
      observation: finding.observation,
      remediation: finding.remediation,
      revalidation_gate: finding.revalidation_gate,
    };
  }

  // Finding from contract
  const f = finding as Finding;
  const inferredFiles: string[] = [];
  const pathRegex = /(?:src|tests|skills|lib|packages|app)\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+/g;
  const combinedText = `${f.observation} ${f.remediation}`;
  const matches = combinedText.match(pathRegex);
  if (matches) {
    for (const match of matches) {
      if (!inferredFiles.includes(match)) {
        inferredFiles.push(match);
      }
    }
  }
  // No path in the text means no path is known. The repository root is not a stand-in for one.
  return {
    id: f.id,
    requirement_id: f.requirement_id,
    severity:
      f.severity === "minor" ? "minor" : f.severity === "critical" ? "critical" : "important",
    file_paths: inferredFiles,
    file_paths_evidence_class: "derived",
    observation: f.observation,
    remediation: f.remediation,
    revalidation_gate: f.revalidation,
  };
}

function pathLine(finding: NormalizedFinding): string | undefined {
  if (finding.file_paths.length === 0) return undefined;
  const paths = finding.file_paths.map((p) => `\`${p}\``).join(", ");
  return finding.file_paths_evidence_class === "agent_reported"
    ? `  - **Affected Files:** ${paths}`
    : `  - **Files Named In The Observation (inferred, not declared):** ${paths}`;
}

function renderFindingGroup(
  lines: string[],
  heading: string,
  group: readonly NormalizedFinding[],
  withRevalidation: boolean,
): void {
  if (group.length === 0) return;
  lines.push(heading);
  for (const finding of group) {
    lines.push(`- **[${finding.id}]** ${finding.observation}`);
    const paths = pathLine(finding);
    if (paths) lines.push(paths);
    lines.push(`  - **Remediation:** ${finding.remediation}`);
    if (withRevalidation && finding.revalidation_gate)
      lines.push(`  - **Revalidation Command:** \`${finding.revalidation_gate}\``);
  }
  lines.push("");
}

export function synthesizeNextRoundPrompt(input: SynthesizeDefectsInput): DefectSynthesis {
  const {
    roundNumber,
    priorRunId,
    originalPrompt,
    findings = [],
    criticFeedback,
    gateFailures = [],
  } = input;

  // Deduplicate findings by id, merging affected file paths
  const dedupedMap = new Map<string, NormalizedFinding>();
  for (const rawFinding of findings) {
    if (rawFinding && typeof rawFinding.id === "string" && rawFinding.id.length > 0) {
      const normalized = normalizeFindingToDetail(rawFinding);
      const existing = dedupedMap.get(normalized.id);
      if (existing) {
        const mergedFiles = Array.from(
          new Set([...existing.file_paths, ...normalized.file_paths]),
        ).sort();
        // A union that absorbed an inferred path is itself inference, so the weaker class wins.
        dedupedMap.set(normalized.id, {
          ...normalized,
          file_paths: mergedFiles,
          file_paths_evidence_class:
            existing.file_paths_evidence_class === normalized.file_paths_evidence_class
              ? normalized.file_paths_evidence_class
              : "derived",
        });
      } else {
        dedupedMap.set(normalized.id, normalized);
      }
    }
  }

  const normalizedFindings = Array.from(dedupedMap.values());

  // Collect all unique affected files
  const affectedFilesSet = new Set<string>();
  for (const f of normalizedFindings) {
    for (const p of f.file_paths) {
      affectedFilesSet.add(p);
    }
  }
  const affectedFiles = Array.from(affectedFilesSet).sort();

  // Group findings by severity
  const critical = normalizedFindings.filter((f) => f.severity === "critical");
  const important = normalizedFindings.filter((f) => f.severity === "important");
  const minor = normalizedFindings.filter(
    (f) => f.severity === "minor" || f.severity === "suggestion",
  );

  const lines: string[] = [];
  lines.push(`## Evolutionary Round ${roundNumber} Refinement Directive`);
  lines.push(`**Parent Run:** \`${priorRunId}\``);
  lines.push("");
  lines.push("### Core Objective (Carried Forward)");
  lines.push(originalPrompt.trim());
  lines.push("");

  if (criticFeedback && criticFeedback.trim().length > 0) {
    lines.push("### Completeness Critic Feedback");
    lines.push(criticFeedback.trim());
    lines.push("");
  }

  if (gateFailures.length > 0) {
    lines.push("### Failed Gate Proofs from Previous Round");
    for (const gf of gateFailures) {
      lines.push(`- ❌ \`${gf}\``);
    }
    lines.push("");
  }

  lines.push(`### Unresolved Defect Synthesis (${normalizedFindings.length} findings)`);

  if (normalizedFindings.length === 0) {
    lines.push(
      "No explicit structured findings recorded. Complete all remaining open requirements and run-level validation gates.",
    );
  } else {
    renderFindingGroup(lines, "#### 🔴 Critical Findings", critical, true);
    renderFindingGroup(lines, "#### 🟡 Important Findings", important, true);
    renderFindingGroup(lines, "#### ⚪ Minor Findings & Suggestions", minor, false);
  }

  lines.push("### Mandatory Next Round Invariants");
  lines.push("1. Remediate all critical and important findings within scoped repair tasks.");
  lines.push("2. Implement explicit non-mocked regression tests for every finding.");
  lines.push("3. Execute all mandatory validation gates and confirm zero pushback.");
  lines.push(
    "4. Obtain Passing Review from Adversarial Validator and Approval from Completeness Critic.",
  );

  const synthesizedPrompt = lines.join("\n");

  return {
    roundNumber,
    priorRunId,
    originalPrompt,
    unresolvedFindings: normalizedFindings,
    criticFeedback,
    gateFailures,
    synthesizedPrompt,
    affectedFiles,
  };
}
