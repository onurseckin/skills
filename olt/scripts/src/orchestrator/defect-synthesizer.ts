import type { EvidenceClass } from "../contracts/evidence.ts";
import type { FindingDetail } from "../workflow/scope-partitioner.ts";
import type { Finding } from "../contracts/workflow.ts";
import type { DefectSynthesis, CriticDecision, RoundGateResult } from "./types.ts";
import type { SmartTaskPlan } from "../mind/smart-task-manager.ts";
import {
  assertAntiBatchingRule,
  deriveGateForCategory,
  deriveWriteScopeForCategory,
  sanitizeSlug,
} from "../mind/smart-task-manager.ts";

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

  const dedupedMap = new Map<string, NormalizedFinding>();
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

  const affectedFilesSet = new Set<string>();
  for (const f of normalizedFindings) {
    for (const p of f.file_paths) {
      affectedFilesSet.add(p);
    }
  }
  const affectedFiles = Array.from(affectedFilesSet).sort();

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

/**
 * Mechanically partitions defect candidates / findings into 1:1 isolated repair tasks,
 * ensuring each defect receives a dedicated implementer and independent validator.
 */
export function partitionDefectsToIsolatedTasks(
  findings: readonly (Finding | FindingDetail)[],
  options: {
    readonly roundNumber?: number | undefined;
    readonly priorRunId?: string | undefined;
    readonly charterGoals?: readonly string[] | undefined;
  } = {},
): readonly SmartTaskPlan[] {
  const round = options.roundNumber ?? 1;
  const goals =
    options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];
  const tasks: SmartTaskPlan[] = [];

  for (let i = 0; i < findings.length; i++) {
    const raw = findings[i]!;
    const normalized = normalizeFindingToDetail(raw);
    const slug = sanitizeSlug(normalized.id);
    const taskId = `repair-r${round}-${i + 1}-${slug}`;

    const scope =
      normalized.file_paths.length > 0
        ? normalized.file_paths
        : deriveWriteScopeForCategory("CORE_ENGINE", normalized.id);

    const gate =
      normalized.revalidation_gate && normalized.revalidation_gate.trim().length > 0
        ? normalized.revalidation_gate.trim()
        : deriveGateForCategory("CORE_ENGINE", scope);

    tasks.push({
      id: taskId,
      label: `Remediate [${normalized.id}] (${normalized.severity}): ${normalized.observation.slice(0, 60)}`,
      write_scope: scope,
      gate,
      charter_goals: goals,
      acceptance_criteria: [
        `Remediate defect finding ${normalized.id}: ${normalized.remediation}`,
        `Verify gate pass: ${gate}`,
        "1:1 implementer-validator isolation verified",
      ],
      dependencies: [],
      source_type: "defect_remediation",
      priority:
        normalized.severity === "critical"
          ? "CRITICAL"
          : normalized.severity === "important"
            ? "HIGH"
            : "MEDIUM",
      rationale: `Isolated repair task for defect [${normalized.id}]: ${normalized.observation}`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-${slug}`,
      assigned_validator: `validator-${slug}`,
      candidate_id: normalized.id,
      metadata: {
        candidate_id: normalized.id,
        assigned_implementer: `implementer-${slug}`,
        assigned_validator: `validator-${slug}`,
      },
    });
  }

  assertAntiBatchingRule(tasks);
  return tasks;
}
