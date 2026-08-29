import { HarnessError } from "../../../core/errors/index.ts";
import type { SupervisoryRole } from "../../../authority/pillars.ts";
import type { CognitiveDimension, CognitiveFlavorId, CognitiveDimensionSpec } from "./types.ts";
import {
  CANONICAL_SELF_QUESTIONING_QUESTION,
  COGNITIVE_DIMENSIONS,
  COGNITIVE_DIMENSION_SPECS,
  COGNITIVE_FLAVOR_IDS,
} from "./types.ts";
import type { CognitiveFlavorProfile, CognitiveFlavorEvaluation } from "./classifier.ts";
import { COGNITIVE_FLAVOR_PROFILES } from "./classifier.ts";
import { join } from "node:path";
export function getCognitiveDimensionSpec(dimension: CognitiveDimension): CognitiveDimensionSpec {
  const spec = COGNITIVE_DIMENSION_SPECS[dimension];
  if (!spec) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown cognitive dimension '${dimension}'; valid dimensions: ${COGNITIVE_DIMENSIONS.join(", ")}`,
    );
  }
  return spec;
}

export function getCognitiveFlavorProfile(flavorId: CognitiveFlavorId): CognitiveFlavorProfile {
  const profile = COGNITIVE_FLAVOR_PROFILES[flavorId];
  if (!profile) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown cognitive flavor '${flavorId}'; valid flavors: ${COGNITIVE_FLAVOR_IDS.join(", ")}`,
    );
  }
  return profile;
}

export function formatCognitivePromptSection(options?: {
  readonly flavorId?: CognitiveFlavorId | undefined;
  readonly role?: SupervisoryRole | "implementer" | "validator" | undefined;
  readonly includeBreakthroughs?: boolean | undefined;
  readonly compact?: boolean | undefined;
}): string {
  const flavorId = options?.flavorId ?? "FIRST_PRINCIPLES";
  const profile = getCognitiveFlavorProfile(flavorId);
  const role = options?.role;
  const compact = options?.compact ?? false;

  const lines: string[] = [];
  lines.push("### 🧠 First-Principles Cognitive Flavor & Self-Questioning");
  lines.push(`**Motto:** *"${profile.coreMotto}"*`);
  lines.push("");
  lines.push(`> **Canonical Reflexive Question:**\n> "${CANONICAL_SELF_QUESTIONING_QUESTION}"`);
  lines.push("");

  if (!compact) {
    lines.push(`**Cognitive Archetype:** ${profile.archetype} (${profile.name})`);
    lines.push(`**Primary Focus:** ${COGNITIVE_DIMENSION_SPECS[profile.primaryDimension].title}`);
    lines.push("");
    lines.push("**6 First-Principles Cognitive Dimensions:**");
    for (const dim of COGNITIVE_DIMENSIONS) {
      const spec = COGNITIVE_DIMENSION_SPECS[dim];
      lines.push(`- 🔷 **${spec.dimension.toUpperCase()}**: ${spec.coreQuestion}`);
    }
    lines.push("");
    lines.push("**Operational Directives:**");
    for (const focus of profile.evaluationFocus) {
      lines.push(`- ⚡ ${focus}`);
    }
  }

  if (role) {
    lines.push("");
    lines.push(`**Role Guidance (${role.toUpperCase()}):**`);
    if (role === "mind") {
      lines.push(
        "- Maintain infinite observe-only consciousness; synthesize radical simplifications for the full system topology.",
      );
    } else if (role === "orchestrator") {
      lines.push(
        "- Supervise execution rounds and eliminate cross-round redundant synthesis overhead.",
      );
    } else if (role === "coordinator") {
      lines.push(
        "- Expand concurrency to Work/Span math (P = W / S), eliminate serial bottlenecks, and enforce disjoint write scopes.",
      );
    } else if (role === "implementer") {
      lines.push(
        "- Enforce strict zero-any types, zero suppressions, and make minimal, elegant, context-sized changes.",
      );
    } else if (role === "validator") {
      lines.push(
        "- Execute adversarial falsification probes, verify gate failure paths, and demand quantitative DOM/screenshot proof.",
      );
    }
  }

  return lines.join("\n").trim();
}

export function formatCognitiveEvaluationBrief(evaluation: CognitiveFlavorEvaluation): string {
  const lines: string[] = [];
  lines.push(`### 🧠 Cognitive Flavor Brief: ${evaluation.primaryFlavor}`);
  lines.push(
    `**Health Score:** ${evaluation.overallCognitiveHealthScore}/100 | **Findings:** ${evaluation.frictionFindings.length} | **Breakthroughs:** ${evaluation.breakthroughProposals.length}`,
  );
  lines.push("");
  lines.push("**Dimensional Posture:**");
  for (const dim of COGNITIVE_DIMENSIONS) {
    const score = evaluation.dimensionScores[dim];
    lines.push(
      `- **${dim}**: ${score.score}/100 [${score.grade}] (${score.findingsCount} issue(s))`,
    );
  }

  if (evaluation.breakthroughProposals.length > 0) {
    lines.push("");
    lines.push("**Synthesized Breakthrough Proposals:**");
    for (const prop of evaluation.breakthroughProposals) {
      lines.push(`- 🚀 **${prop.title}** (${prop.targetDimension}): ${prop.rationale}`);
    }
  }

  return lines.join("\n").trim();
}
