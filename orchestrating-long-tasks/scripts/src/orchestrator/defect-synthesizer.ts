import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { Finding, GateResult } from "../contracts/workflow.ts";
import type { DefectSynthesis, CriticDecision } from "./types.ts";

export interface SynthesizeDefectsInput {
  readonly roundNumber: number;
  readonly priorRunId: string;
  readonly originalPrompt: string;
  readonly findings?: readonly (Finding | FindingDetail)[] | undefined;
  readonly criticDecision?: CriticDecision | undefined;
  readonly criticFeedback?: string | undefined;
  readonly gateResults?: readonly GateResult[] | undefined;
  readonly gateFailures?: readonly string[] | undefined;
}

function isFindingDetail(finding: Finding | FindingDetail): finding is FindingDetail {
  return (
    "file_paths" in finding &&
    Array.isArray(finding.file_paths) &&
    finding.file_paths.every((p) => typeof p === "string")
  );
}

export function normalizeFindingToDetail(finding: Finding | FindingDetail): FindingDetail {
  if (isFindingDetail(finding)) {
    return {
      id: finding.id,
      requirement_id: finding.requirement_id,
      severity: finding.severity || "important",
      file_paths: finding.file_paths,
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
  if (inferredFiles.length === 0) {
    inferredFiles.push(".");
  }

  return {
    id: f.id,
    requirement_id: f.requirement_id,
    severity:
      f.severity === "minor" ? "minor" : f.severity === "critical" ? "critical" : "important",
    file_paths: inferredFiles,
    observation: f.observation,
    remediation: f.remediation,
    revalidation_gate: f.revalidation,
  };
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
  const dedupedMap = new Map<string, FindingDetail>();
  for (const rawFinding of findings) {
    if (rawFinding && typeof rawFinding.id === "string" && rawFinding.id.length > 0) {
      const normalized = normalizeFindingToDetail(rawFinding);
      const existing = dedupedMap.get(normalized.id);
      if (existing) {
        const mergedFiles = Array.from(
          new Set([...existing.file_paths, ...normalized.file_paths]),
        ).sort();
        dedupedMap.set(normalized.id, {
          ...normalized,
          file_paths: mergedFiles,
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
    if (critical.length > 0) {
      lines.push("#### 🔴 Critical Findings");
      for (const f of critical) {
        lines.push(`- **[${f.id}]** ${f.observation}`);
        lines.push(`  - **Affected Files:** ${f.file_paths.map((p) => `\`${p}\``).join(", ")}`);
        lines.push(`  - **Remediation:** ${f.remediation}`);
        if (f.revalidation_gate) {
          lines.push(`  - **Revalidation Command:** \`${f.revalidation_gate}\``);
        }
      }
      lines.push("");
    }

    if (important.length > 0) {
      lines.push("#### 🟡 Important Findings");
      for (const f of important) {
        lines.push(`- **[${f.id}]** ${f.observation}`);
        lines.push(`  - **Affected Files:** ${f.file_paths.map((p) => `\`${p}\``).join(", ")}`);
        lines.push(`  - **Remediation:** ${f.remediation}`);
        if (f.revalidation_gate) {
          lines.push(`  - **Revalidation Command:** \`${f.revalidation_gate}\``);
        }
      }
      lines.push("");
    }

    if (minor.length > 0) {
      lines.push("#### ⚪ Minor Findings & Suggestions");
      for (const f of minor) {
        lines.push(`- **[${f.id}]** ${f.observation}`);
        lines.push(`  - **Affected Files:** ${f.file_paths.map((p) => `\`${p}\``).join(", ")}`);
        lines.push(`  - **Remediation:** ${f.remediation}`);
      }
      lines.push("");
    }
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
