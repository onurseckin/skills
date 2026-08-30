import { synthesizeFlavorBreakthroughProposals } from "./proposals.ts";
import { CANONICAL_SELF_QUESTIONING_QUESTION } from "./types.ts";
import type { CognitiveDimension, CognitiveFlavorId } from "./types.ts";
import { COGNITIVE_DIMENSIONS, COGNITIVE_FLAVOR_IDS, COGNITIVE_DIMENSION_SPECS } from "./types.ts";
import type {
  CognitiveFlavorProfile,
  CognitiveFlavorEvaluation,
  CognitiveEvaluationStateInput,
  CognitiveDimensionScore,
  CognitiveFrictionFinding,
  BreakthroughProposal,
} from "./classifier.ts";
import { COGNITIVE_FLAVOR_PROFILES } from "./classifier.ts";
export function evaluateCognitiveState(
  input: CognitiveEvaluationStateInput,
  flavorId: CognitiveFlavorId = "FIRST_PRINCIPLES",
): CognitiveFlavorEvaluation {
  const frictionFindings: CognitiveFrictionFinding[] = [];

  let simplerScore = 100;
  if ((input.totalLinesOfCode ?? 0) > 20000) {
    simplerScore -= 20;
    frictionFindings.push({
      id: "FRIC-SIMP-001",
      dimension: "simpler",
      severity: "MEDIUM",
      title: "Elevated Codebase Size & Abstraction Density",
      description: `Total lines of code (${input.totalLinesOfCode}) suggests opportunities for module pruning and abstraction collapsing.`,
      metricObserved: input.totalLinesOfCode,
      recommendedBreakthrough: "Collapse multi-pass handlers into unified single-pass scanners.",
    });
  }
  if ((input.sourceFilesCount ?? 0) > 100) {
    simplerScore -= 10;
    frictionFindings.push({
      id: "FRIC-SIMP-002",
      dimension: "simpler",
      severity: "LOW",
      title: "High Module Count",
      description: `Source file count (${input.sourceFilesCount}) may contain redundant shims or pass-through adapters.`,
      metricObserved: input.sourceFilesCount,
      recommendedBreakthrough:
        "Consolidate small companion utilities into cohesive domain modules.",
    });
  }

  let betterScore = 100;
  if ((input.supervisoryFileEditsCount ?? 0) > 0) {
    betterScore -= 50;
    frictionFindings.push({
      id: "FRIC-BETT-001",
      dimension: "better",
      severity: "CRITICAL",
      title: "Supervisor Zero-File-Edit Rule Violation",
      description: `Detected ${input.supervisoryFileEditsCount} direct file modifications on supervisory lead threads.`,
      metricObserved: input.supervisoryFileEditsCount,
      recommendedBreakthrough:
        "Enforce pure delegation: delegate all code edits to leased Tier 3 Implementers.",
    });
  }

  let fasterScore = 100;
  const work = input.totalWorkUnits ?? 1;
  const span = input.criticalPathSpan ?? 1;
  const theoreticalHeadroom = Math.ceil(work / Math.max(1, span));
  const activeConcurrency = input.activeConcurrency ?? 1;
  if (theoreticalHeadroom > activeConcurrency * 2) {
    fasterScore -= 25;
    frictionFindings.push({
      id: "FRIC-FAST-001",
      dimension: "faster",
      severity: "HIGH",
      title: "Under-Utilized Algorithmic Concurrency Headroom ($P = W / S$)",
      description: `Theoretical Work/Span concurrency is ${theoreticalHeadroom}, but active worker concurrency is only ${activeConcurrency}.`,
      metricObserved: `${activeConcurrency} / ${theoreticalHeadroom}`,
      recommendedBreakthrough:
        "Dispatch independent DAG lanes in parallel wave arrays via continuous anti-batching.",
    });
  }
  if (input.idleLoopDetected) {
    fasterScore -= 30;
    frictionFindings.push({
      id: "FRIC-FAST-002",
      dimension: "faster",
      severity: "HIGH",
      title: "Idle Loop Detected in Execution Cadence",
      description:
        "Mind or Coordinator experienced passive idling instead of autonomic task discovery or perpetual pulsing.",
      recommendedBreakthrough:
        "Engage perpetual self-evolution loop to synthesize candidate tasks when queues empty.",
    });
  }

  let visualScore = 100;
  if ((input.missingViewportCoverageCount ?? 0) > 0) {
    visualScore -= 35;
    frictionFindings.push({
      id: "FRIC-VISU-001",
      dimension: "more_visual",
      severity: "HIGH",
      title: "Missing 4-Tier Viewport Resolution Coverage",
      description: `Found ${input.missingViewportCoverageCount} UI task(s) lacking complete multi-viewport rasterized captures.`,
      metricObserved: input.missingViewportCoverageCount,
      recommendedBreakthrough:
        "Execute 4-tier viewport captures (Desktop-Wide, Desktop, Tablet, Mobile) with DOM JSON metrics.",
    });
  }

  let tokenScore = 100;
  if (input.unboundedOutputDetected) {
    tokenScore -= 30;
    frictionFindings.push({
      id: "FRIC-TOKE-001",
      dimension: "more_token_efficient",
      severity: "HIGH",
      title: "Unbounded CLI Output Exceeding Line Limit",
      description:
        "CLI command returned un-bounded output exceeding the 30-line threshold, risking context compaction.",
      recommendedBreakthrough:
        "Wrap command output in `enforceLineLimit(output, 30)` with structured next actions.",
    });
  }

  let qualityScore = 100;
  if ((input.anyTypesCount ?? 0) > 0) {
    qualityScore -= 40;
    frictionFindings.push({
      id: "FRIC-QUAL-001",
      dimension: "higher_quality",
      severity: "CRITICAL",
      title: "TypeScript `any` Type Annotations Detected",
      description: `Detected ${input.anyTypesCount} untyped \`any\` references violating zero-any type safety invariants.`,
      metricObserved: input.anyTypesCount,
      recommendedBreakthrough:
        "Replace `any` with precise discriminated unions, generic type bounds, or `unknown` with narrowing.",
    });
  }
  if ((input.suppressionsCount ?? 0) > 0) {
    qualityScore -= 30;
    frictionFindings.push({
      id: "FRIC-QUAL-002",
      dimension: "higher_quality",
      severity: "HIGH",
      title: "Compiler Suppressions Present",
      description: `Detected ${input.suppressionsCount} compiler/linter suppression comments (@ts-ignore / @ts-expect-error).`,
      metricObserved: input.suppressionsCount,
      recommendedBreakthrough:
        "Resolve underlying type discrepancies directly without compiler suppressions.",
    });
  }
  if ((input.unprovenGatesCount ?? 0) > 0) {
    qualityScore -= 20;
    frictionFindings.push({
      id: "FRIC-QUAL-003",
      dimension: "higher_quality",
      severity: "MEDIUM",
      title: "Unproven Verification Gates (`gate:prove`)",
      description: `Found ${input.unprovenGatesCount} compiled task gates lacking negative failure verification on scratch copies.`,
      metricObserved: input.unprovenGatesCount,
      recommendedBreakthrough:
        "Run `gate:prove` on disposable scratch copies to verify gates reliably fail on defects.",
    });
  }
  if ((input.qualitativePassesCount ?? 0) > 0) {
    qualityScore -= 25;
    frictionFindings.push({
      id: "FRIC-QUAL-004",
      dimension: "higher_quality",
      severity: "HIGH",
      title: "Qualitative-Only Validation Passes Detected",
      description: `Detected ${input.qualitativePassesCount} validator reviews lacking quantitative metric proof.`,
      metricObserved: input.qualitativePassesCount,
      recommendedBreakthrough:
        "Issue `coordinator:pushback` and require DOM bounding boxes, APCA contrast ratings, and screenshot bytes.",
    });
  }

  simplerScore = Math.max(0, Math.min(100, simplerScore));
  betterScore = Math.max(0, Math.min(100, betterScore));
  fasterScore = Math.max(0, Math.min(100, fasterScore));
  visualScore = Math.max(0, Math.min(100, visualScore));
  tokenScore = Math.max(0, Math.min(100, tokenScore));
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  function scoreToGrade(score: number): CognitiveDimensionScore["grade"] {
    if (score >= 90) return "OPTIMAL";
    if (score >= 75) return "HEALTHY";
    if (score >= 50) return "NEEDS_SIMPLIFICATION";
    return "CRITICAL_FRICTION";
  }

  const dimensionScores: Record<CognitiveDimension, CognitiveDimensionScore> = {
    simpler: {
      dimension: "simpler",
      score: simplerScore,
      grade: scoreToGrade(simplerScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "simpler").length,
      summary: `Score ${simplerScore}/100 (${scoreToGrade(simplerScore)}) - ${COGNITIVE_DIMENSION_SPECS.simpler.title}`,
    },
    better: {
      dimension: "better",
      score: betterScore,
      grade: scoreToGrade(betterScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "better").length,
      summary: `Score ${betterScore}/100 (${scoreToGrade(betterScore)}) - ${COGNITIVE_DIMENSION_SPECS.better.title}`,
    },
    faster: {
      dimension: "faster",
      score: fasterScore,
      grade: scoreToGrade(fasterScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "faster").length,
      summary: `Score ${fasterScore}/100 (${scoreToGrade(fasterScore)}) - ${COGNITIVE_DIMENSION_SPECS.faster.title}`,
    },
    more_visual: {
      dimension: "more_visual",
      score: visualScore,
      grade: scoreToGrade(visualScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "more_visual").length,
      summary: `Score ${visualScore}/100 (${scoreToGrade(visualScore)}) - ${COGNITIVE_DIMENSION_SPECS.more_visual.title}`,
    },
    more_token_efficient: {
      dimension: "more_token_efficient",
      score: tokenScore,
      grade: scoreToGrade(tokenScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "more_token_efficient").length,
      summary: `Score ${tokenScore}/100 (${scoreToGrade(tokenScore)}) - ${COGNITIVE_DIMENSION_SPECS.more_token_efficient.title}`,
    },
    higher_quality: {
      dimension: "higher_quality",
      score: qualityScore,
      grade: scoreToGrade(qualityScore),
      findingsCount: frictionFindings.filter((f) => f.dimension === "higher_quality").length,
      summary: `Score ${qualityScore}/100 (${scoreToGrade(qualityScore)}) - ${COGNITIVE_DIMENSION_SPECS.higher_quality.title}`,
    },
  };

  const totalScore = Math.round(
    (simplerScore + betterScore + fasterScore + visualScore + tokenScore + qualityScore) / 6,
  );
  const breakthroughProposals = synthesizeFlavorBreakthroughProposals(
    simplerScore,
    fasterScore,
    qualityScore,
  );
  const flavorProfile =
    COGNITIVE_FLAVOR_PROFILES[flavorId] ?? COGNITIVE_FLAVOR_PROFILES["FIRST_PRINCIPLES"];

  return {
    evaluatedAt: new Date().toISOString(),
    canonicalQuestion: CANONICAL_SELF_QUESTIONING_QUESTION,
    overallCognitiveHealthScore: totalScore,
    primaryFlavor: flavorId,
    dimensionScores,
    frictionFindings,
    breakthroughProposals,
    promptGuidance: flavorProfile.promptGuidance,
    summary: `Cognitive Health Score: ${totalScore}/100 (${scoreToGrade(totalScore)}). Evaluated ${frictionFindings.length} friction finding(s) and synthesized ${breakthroughProposals.length} breakthrough proposal(s) under flavor '${flavorProfile.name}'.`,
  };
}
