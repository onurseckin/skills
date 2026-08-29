import { HarnessError } from "../../../core/errors/index.ts";
import type { CognitiveDimension, CognitiveFlavorId } from "./types.ts";
export interface CognitiveFlavorProfile {
  readonly id: CognitiveFlavorId;
  readonly name: string;
  readonly archetype: string;
  readonly primaryDimension: CognitiveDimension;
  readonly secondaryDimensions: readonly CognitiveDimension[];
  readonly coreMotto: string;
  readonly promptGuidance: string;
  readonly evaluationFocus: readonly string[];
}

export const COGNITIVE_FLAVOR_PROFILES: Readonly<
  Record<CognitiveFlavorId, CognitiveFlavorProfile>
> = {
  FIRST_PRINCIPLES: {
    id: "FIRST_PRINCIPLES",
    name: "First-Principles Radical Simplifier",
    archetype: "Fundamental Axiom Questioner & Abstraction Pruner",
    primaryDimension: "simpler",
    secondaryDimensions: ["better", "more_token_efficient"],
    coreMotto:
      "Question every assumption from bedrock fundamentals; eliminate all ceremonial friction.",
    promptGuidance:
      "Constantly challenge legacy assumptions and unnecessary abstraction layers. Seek radical directness, small context-sized modules, and elegant simplicity.",
    evaluationFocus: [
      "Identify unnecessary wrappers and pass-through abstractions.",
      "Prune unused legacy options and ceremonial code paths.",
      "Synthesize first-principles architectural simplifications.",
    ],
  },
  ARCHITECTURAL_ELEGANCE: {
    id: "ARCHITECTURAL_ELEGANCE",
    name: "Architectural Elegance & Contract Guardian",
    archetype: "Boundary Enforcer & Structural Architect",
    primaryDimension: "better",
    secondaryDimensions: ["higher_quality", "simpler"],
    coreMotto: "Unbreakable boundaries, pure delegation, and zero supervisory file mutation.",
    promptGuidance:
      "Maintain flawless 4-tier hierarchy discipline. Ensure supervisory threads stay empty of implementation code and enforce strict write scope confinement.",
    evaluationFocus: [
      "Verify strict role tier boundary adherence.",
      "Audit write scope exclusivity across active leases.",
      "Ensure immutability of historical logs and generational lineages.",
    ],
  },
  RADICAL_OBSERVABILITY: {
    id: "RADICAL_OBSERVABILITY",
    name: "Radical Observability & Visual Truth",
    archetype: "Topology Cartographer & Quantitative Proof Demander",
    primaryDimension: "more_visual",
    secondaryDimensions: ["higher_quality", "better"],
    coreMotto: "Visual truth over subjective assertions; quantitative proof in every report.",
    promptGuidance:
      "Expose system state through live Unicode DAG visualizers, 4-tier viewport captures, and quantitative DOM/APCA metrics. Never accept unmeasured claims.",
    evaluationFocus: [
      "Ensure DAG topologies are visualizable in ASCII/Unicode format.",
      "Verify 4-Tier Viewport Matrix compliance for all visual tasks.",
      "Demand quantitative metrics and screenshot byte proofs (> 1024B).",
    ],
  },
  TOKEN_PARSIMONY: {
    id: "TOKEN_PARSIMONY",
    name: "Token Parsimony & CLI-First GPS",
    archetype: "Context Conservationist & Action Chainer",
    primaryDimension: "more_token_efficient",
    secondaryDimensions: ["faster", "simpler"],
    coreMotto: "High-density structured CLI verbs, bounded outputs, and zero-token GPS chains.",
    promptGuidance:
      "Prevent token bloat and context compaction. Use bounded CLI outputs (<= 30 lines), actionable Next Actions footers, and disk-backed Capsule Memory.",
    evaluationFocus: [
      "Enforce 30-line output bounding on CLI commands.",
      "Verify zero-token CLI GPS action-chaining in command footers.",
      "Decouple heavy logs into disk-based Capsule Memory.",
    ],
  },
  ADVERSARIAL_SCEPTICISM: {
    id: "ADVERSARIAL_SCEPTICISM",
    name: "Adversarial Sceptic & Falsification Prover",
    archetype: "Counterfactual Prober & Quality Hardener",
    primaryDimension: "higher_quality",
    secondaryDimensions: ["better", "more_visual"],
    coreMotto: "Trust nothing unproven; demand adversarial probe proof and falsifiable gates.",
    promptGuidance:
      "Actively challenge positive assertions. Run `gate:prove` on disposable scratch copies to verify gates can fail, and demand adversarial edge case proofs.",
    evaluationFocus: [
      "Verify gate falsifiability via disposable scratch negative proofs.",
      "Mandate adversarial probe rounds before certifying pass verdicts.",
      "Enforce zero TypeScript `any` and zero compiler suppressions.",
    ],
  },
  PERPETUAL_VITALITY: {
    id: "PERPETUAL_VITALITY",
    name: "Perpetual Vitality & Infinite Cadence",
    archetype: "Continuous Consciousness & Generational Evolver",
    primaryDimension: "faster",
    secondaryDimensions: ["simpler", "better"],
    coreMotto:
      "Closing is forbidden; dynamic Work/Span concurrency (P = W / S) without artificial limits.",
    promptGuidance:
      "Operate as an infinite autonomous consciousness loop. Dynamically scale concurrency to Work/Span math, continuously discover tasks, and rotate generations seamlessly.",
    evaluationFocus: [
      "Maintain continuous supervisory heartbeats and pulse loops.",
      "Scale parallel concurrency to Work/Span headroom (P = W / S).",
      "Synthesize autonomous self-evolution tasks when queues empty.",
    ],
  },
};

export interface CognitiveFrictionFinding {
  readonly id: string;
  readonly dimension: CognitiveDimension;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly title: string;
  readonly description: string;
  readonly location?: string | undefined;
  readonly metricObserved?: string | number | undefined;
  readonly recommendedBreakthrough: string;
}

export interface BreakthroughProposal {
  readonly id: string;
  readonly title: string;
  readonly targetDimension: CognitiveDimension;
  readonly rationale: string;
  readonly firstPrinciplesAnalysis: string;
  readonly estimatedSimplicityGain: string;
  readonly estimatedLatencyReduction: string;
  readonly implementationPlan: readonly string[];
}

export interface CognitiveEvaluationStateInput {
  readonly workspaceRoot?: string | undefined;
  readonly sourceFilesCount?: number | undefined;
  readonly testFilesCount?: number | undefined;
  readonly totalLinesOfCode?: number | undefined;
  readonly anyTypesCount?: number | undefined;
  readonly suppressionsCount?: number | undefined;
  readonly criticalPathSpan?: number | undefined;
  readonly totalWorkUnits?: number | undefined;
  readonly activeConcurrency?: number | undefined;
  readonly unboundedOutputDetected?: boolean | undefined;
  readonly missingViewportCoverageCount?: number | undefined;
  readonly unprovenGatesCount?: number | undefined;
  readonly qualitativePassesCount?: number | undefined;
  readonly idleLoopDetected?: boolean | undefined;
  readonly supervisoryFileEditsCount?: number | undefined;
}

export interface CognitiveDimensionScore {
  readonly dimension: CognitiveDimension;
  readonly score: number; // 0 to 100
  readonly grade: "OPTIMAL" | "HEALTHY" | "NEEDS_SIMPLIFICATION" | "CRITICAL_FRICTION";
  readonly findingsCount: number;
  readonly summary: string;
}

export interface CognitiveFlavorEvaluation {
  readonly evaluatedAt: string;
  readonly canonicalQuestion: string;
  readonly overallCognitiveHealthScore: number; // 0 to 100
  readonly primaryFlavor: CognitiveFlavorId;
  readonly dimensionScores: Readonly<Record<CognitiveDimension, CognitiveDimensionScore>>;
  readonly frictionFindings: readonly CognitiveFrictionFinding[];
  readonly breakthroughProposals: readonly BreakthroughProposal[];
  readonly promptGuidance: string;
  readonly summary: string;
}

/**
 * Evaluates the cognitive state of the system against the 6 First-Principles dimensions.
 */
