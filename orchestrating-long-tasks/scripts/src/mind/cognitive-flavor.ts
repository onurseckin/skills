/**
 * Unified Innovative Mind Cognition & Self-Questioning Flavor Subsystem.
 * Implements first-principles cognitive evaluation, reflexive self-questioning loops,
 * cognitive flavor personas, breakthrough opportunity synthesis, and prompt formatting.
 *
 * Core Mantra: "How can this system be made simpler, better, faster, more visual,
 * more token-efficient, and higher quality?"
 */

import { HarnessError } from "../errors/harness-error.ts";
import {
  COGNITIVE_PILLARS,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
  getCognitivePillar,
} from "../authority/pillars.ts";

export const CANONICAL_SELF_QUESTIONING_QUESTION =
  "How can this system be made simpler, better, faster, more visual, more token-efficient, and higher quality?" as const;

export type CognitiveDimension =
  | "simpler"
  | "better"
  | "faster"
  | "more_visual"
  | "more_token_efficient"
  | "higher_quality";

export const COGNITIVE_DIMENSIONS: readonly CognitiveDimension[] = [
  "simpler",
  "better",
  "faster",
  "more_visual",
  "more_token_efficient",
  "higher_quality",
] as const;

export type CognitiveFlavorId =
  | "FIRST_PRINCIPLES"
  | "ARCHITECTURAL_ELEGANCE"
  | "RADICAL_OBSERVABILITY"
  | "TOKEN_PARSIMONY"
  | "ADVERSARIAL_SCEPTICISM"
  | "PERPETUAL_VITALITY";

export const COGNITIVE_FLAVOR_IDS: readonly CognitiveFlavorId[] = [
  "FIRST_PRINCIPLES",
  "ARCHITECTURAL_ELEGANCE",
  "RADICAL_OBSERVABILITY",
  "TOKEN_PARSIMONY",
  "ADVERSARIAL_SCEPTICISM",
  "PERPETUAL_VITALITY",
] as const;

export interface CognitiveDimensionSpec {
  readonly dimension: CognitiveDimension;
  readonly title: string;
  readonly coreQuestion: string;
  readonly mappedPillarId: CognitivePillarId;
  readonly principles: readonly string[];
  readonly antipatterns: readonly string[];
  readonly breakthroughExamples: readonly string[];
}

export const COGNITIVE_DIMENSION_SPECS: Readonly<Record<CognitiveDimension, CognitiveDimensionSpec>> = {
  simpler: {
    dimension: "simpler",
    title: "Radical Simplification & Abstraction Pruning",
    coreQuestion: "How can this system be made simpler by eliminating accidental complexity and ceremonial bloat?",
    mappedPillarId: 6,
    principles: [
      "Eliminate redundant abstraction layers, pass-through wrappers, and premature abstractions.",
      "Collapse multi-file ceremony into cohesive, context-sized single modules.",
      "Prefer direct domain operations over generic meta-frameworks.",
      "Question every legacy invariant: if a rule does not serve correctness or safety, delete it.",
    ],
    antipatterns: [
      "Over-engineering simple data pipelines with layered handler classes.",
      "Creating abstract base classes for single implementations.",
      "Adding configuration indirection when direct constants suffice.",
      "Retaining obsolete compatibility shims across generational rotations.",
    ],
    breakthroughExamples: [
      "Replacing recursive directory walking logic with unified single-pass scanners.",
      "Zero-token CLI GPS action-chaining replacing interactive search menus.",
      "Single-line harness error dispatching instead of custom error hierarchies.",
    ],
  },
  better: {
    dimension: "better",
    title: "Architectural Soundness & Invariant Enforcement",
    coreQuestion: "How can this system be made better through tighter contracts, cleaner boundaries, and stronger guarantees?",
    mappedPillarId: 3,
    principles: [
      "Enforce unbreakable tier boundaries (Tier 0 Mind -> Tier 1 Orchestrator -> Tier 2 Coordinator -> Tier 3 Workers).",
      "Confine file modifications exclusively to leased worker write scopes with zero supervisor edits.",
      "Preserve historical lineage and charter pins immutably across generational rotations.",
      "Make illegal states unrepresentable in TypeScript type definitions.",
    ],
    antipatterns: [
      "Supervisory leads succumbing to the 'trivial fix' fallacy and editing files directly.",
      "Cross-tier spawning bypassing the supervisory hierarchy.",
      "Loose string parameters instead of closed discriminated union literals.",
      "Leaking uncommitted transient mutations into global capsule state.",
    ],
    breakthroughExamples: [
      "Disjoint write scope leasing with SHA256 content verification.",
      "Dual-channel DOM + screenshot proof synthesis eliminating blind spots.",
      "Generational lineage anchoring via immutable rotation manifests.",
    ],
  },
  faster: {
    dimension: "faster",
    title: "Topological Concurrency & Latency Minimization",
    coreQuestion: "How can this system be made faster by maximizing parallelism ($P = W / S$) and removing serial bottlenecks?",
    mappedPillarId: 7,
    principles: [
      "Dynamically scale concurrency to Work/Span algorithmic headroom (P = W / S).",
      "Continuous 1:1 anti-batching dispatch: dispatch ready tasks the instant capacity frees.",
      "Deploy dedicated parallel Domain Coordinators across disjoint candidate scopes.",
      "Eliminate artificial daily limits, wall-clock pauses, and budget refusal ladders.",
    ],
    antipatterns: [
      "Waiting for entire wave barriers before evaluating and dispatching subsequent tasks.",
      "Serializing independent subsystem tasks into sequential execution chains.",
      "Imposing arbitrary fixed concurrency caps regardless of DAG breadth.",
      "Polling in busy loops instead of reactive timer/stream wakeups.",
    ],
    breakthroughExamples: [
      "Topological wave compilation with automatic critical path span reduction.",
      "Multi-coordinator parallelization scaling across independent subdomains.",
      "Asynchronous non-blocking heartbeat tracking with 3-minute intervals.",
    ],
  },
  more_visual: {
    dimension: "more_visual",
    title: "Visual Truth & Radical Observability",
    coreQuestion: "How can this system be made more visual through rich ASCII/Unicode DAG graphs and quantitative proof?",
    mappedPillarId: 2,
    principles: [
      "Render live execution topologies as Unicode boxed DAGs with status indicators and coordinates.",
      "Synthesize Dual-Channel DOM metrics (`visual-report.json`) and screenshot captures (> 1024B).",
      "Mandate 4-Tier Viewport Resolution Matrix coverage on all UI/frontend modifications.",
      "Reject subjective or qualitative pass verdicts lacking quantitative metric evidence.",
    ],
    antipatterns: [
      "Accepting 'looks good to me' review claims without visual or quantitative proof.",
      "Ignoring viewport responsiveness across tablet and mobile form factors.",
      "Generating 0-byte or placeholder screenshot artifacts.",
      "Hiding execution bottlenecks inside dense raw log streams.",
    ],
    breakthroughExamples: [
      "Sugiyama layered DAG visualizer rendering multi-wave topologies in ASCII/Unicode.",
      "4-Tier Viewport Resolution Matrix (1920x1080, 1440x900, 768x1024, 390x844).",
      "APCA Lc visual contrast rating calculations on rendered UI text nodes.",
    ],
  },
  more_token_efficient: {
    dimension: "more_token_efficient",
    title: "CLI-First Token Leverage & Parsimony",
    coreQuestion: "How can this system be made more token-efficient to eliminate context bloat and prevent compaction?",
    mappedPillarId: 1,
    principles: [
      "Prevent token bloat by using structured CLI commands with strict line limiters (<= 30 lines).",
      "Follow zero-token CLI GPS action-chaining recommendations provided in command footers.",
      "Decouple heavy logs and error traces into Capsule Memory on disk; query on demand.",
      "Return structured JSON or high-density markdown briefs instead of raw file dumps.",
    ],
    antipatterns: [
      "Dumping hundreds of lines of raw harness code or log dumps into agent context.",
      "Re-reading entire unmodified files repeatedly across execution steps.",
      "Writing verbose repetitive prose instead of compact structured summaries.",
      "Unbounded recursive search outputs that overwhelm agent memory buffers.",
    ],
    breakthroughExamples: [
      "Enforce 30-line bounded CLI output wrappers with next-action guidance footers.",
      "On-demand capsule disk inspection via `stream:events`, `report:task`, and `explain`.",
      "Structured task packet generation with exact sliced context and leased write scopes.",
    ],
  },
  higher_quality: {
    dimension: "higher_quality",
    title: "Strict Type Safety & Adversarial Gate Hardening",
    coreQuestion: "How can this system be made higher quality with zero untyped code and falsifiable verification gates?",
    mappedPillarId: 6,
    principles: [
      "STRICT ZERO-ANY & ZERO-SUPPRESSION: 0 TypeScript `any`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 lint suppressions.",
      "Prove compiled task gates can fail on disposable scratch copies (`gate:prove`) before trusting them.",
      "Record mandatory adversarial probe rounds (`task:probe`) before certifying pass verdicts.",
      "Add explicit regression test suites for every repaired defect finding.",
    ],
    antipatterns: [
      "Using `any` as an escape hatch for complex type narrowing or third-party interop.",
      "Suppressing compiler type errors with `@ts-ignore` or `@ts-expect-error`.",
      "Tautological or un-falsifiable test suites that always pass regardless of implementation.",
      "Rubber-stamping validation reviews without running independent verification commands.",
    ],
    breakthroughExamples: [
      "Adversarial Gate Prover (`gate:prove`) with negative mutation testing on scratch copies.",
      "Strict TypeScript compile-time contract checking with zero allowed compiler suppressions.",
      "Multi-round scepticism pushback demanding quantitative proof and edge case coverage.",
    ],
  },
};

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

export const COGNITIVE_FLAVOR_PROFILES: Readonly<Record<CognitiveFlavorId, CognitiveFlavorProfile>> = {
  FIRST_PRINCIPLES: {
    id: "FIRST_PRINCIPLES",
    name: "First-Principles Radical Simplifier",
    archetype: "Fundamental Axiom Questioner & Abstraction Pruner",
    primaryDimension: "simpler",
    secondaryDimensions: ["better", "more_token_efficient"],
    coreMotto: "Question every assumption from bedrock fundamentals; eliminate all ceremonial friction.",
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
    coreMotto: "Closing is forbidden; dynamic Work/Span concurrency (P = W / S) without artificial limits.",
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
export function evaluateCognitiveState(
  input: CognitiveEvaluationStateInput,
  flavorId: CognitiveFlavorId = "FIRST_PRINCIPLES",
): CognitiveFlavorEvaluation {
  const frictionFindings: CognitiveFrictionFinding[] = [];
  const breakthroughProposals: BreakthroughProposal[] = [];

  // 1. Evaluate Dimension: Simpler
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
      recommendedBreakthrough: "Consolidate small companion utilities into cohesive domain modules.",
    });
  }

  // 2. Evaluate Dimension: Better
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
      recommendedBreakthrough: "Enforce pure delegation: delegate all code edits to leased Tier 3 Implementers.",
    });
  }

  // 3. Evaluate Dimension: Faster
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
      recommendedBreakthrough: "Dispatch independent DAG lanes in parallel wave arrays via continuous anti-batching.",
    });
  }
  if (input.idleLoopDetected) {
    fasterScore -= 30;
    frictionFindings.push({
      id: "FRIC-FAST-002",
      dimension: "faster",
      severity: "HIGH",
      title: "Idle Loop Detected in Execution Cadence",
      description: "Mind or Coordinator experienced passive idling instead of autonomic task discovery or perpetual pulsing.",
      recommendedBreakthrough: "Engage perpetual self-evolution loop to synthesize candidate tasks when queues empty.",
    });
  }

  // 4. Evaluate Dimension: More Visual
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
      recommendedBreakthrough: "Execute 4-tier viewport captures (Desktop-Wide, Desktop, Tablet, Mobile) with DOM JSON metrics.",
    });
  }

  // 5. Evaluate Dimension: More Token-Efficient
  let tokenScore = 100;
  if (input.unboundedOutputDetected) {
    tokenScore -= 30;
    frictionFindings.push({
      id: "FRIC-TOKE-001",
      dimension: "more_token_efficient",
      severity: "HIGH",
      title: "Unbounded CLI Output Exceeding Line Limit",
      description: "CLI command returned un-bounded output exceeding the 30-line threshold, risking context compaction.",
      recommendedBreakthrough: "Wrap command output in `enforceLineLimit(output, 30)` with structured next actions.",
    });
  }

  // 6. Evaluate Dimension: Higher Quality
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
      recommendedBreakthrough: "Replace `any` with precise discriminated unions, generic type bounds, or `unknown` with narrowing.",
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
      recommendedBreakthrough: "Resolve underlying type discrepancies directly without compiler suppressions.",
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
      recommendedBreakthrough: "Run `gate:prove` on disposable scratch copies to verify gates reliably fail on defects.",
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
      recommendedBreakthrough: "Issue `coordinator:pushback` and require DOM bounding boxes, APCA contrast ratings, and screenshot bytes.",
    });
  }

  // Normalize scores between 0 and 100
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

  // Synthesize breakthrough proposals for lowest scoring dimensions
  if (simplerScore < 85) {
    breakthroughProposals.push({
      id: "PROP-SIMP-001",
      title: "Radical Architecture & File Consolidation",
      targetDimension: "simpler",
      rationale: "Excess abstraction layers and fragmented utility modules introduce cognitive friction and maintenance overhead.",
      firstPrinciplesAnalysis:
        "Every layer of indirection must justify its existence with concrete isolation benefits. Direct module exports eliminate redundant mapping logic.",
      estimatedSimplicityGain: "40% reduction in mental hops and import graph depth",
      estimatedLatencyReduction: "Faster test suite startup and quicker file discovery",
      implementationPlan: [
        "Audit module dependency graphs for 1:1 pass-through wrappers.",
        "Consolidate companion utilities into unified domain modules.",
        "Remove obsolete abstraction shims.",
      ],
    });
  }

  if (fasterScore < 85) {
    breakthroughProposals.push({
      id: "PROP-FAST-001",
      title: "Topological Concurrency Expansion ($P = W / S$)",
      targetDimension: "faster",
      rationale: "Independent tasks are being queued serially despite available Work/Span parallelism headroom.",
      firstPrinciplesAnalysis:
        "When write scopes are disjoint, tasks have zero resource contention. Concurrency is limited only by topological span length $S$.",
      estimatedSimplicityGain: "Elimination of complex queue synchronization barriers",
      estimatedLatencyReduction: "Up to 3x wall-clock execution speedup via parallel wave lanes",
      implementationPlan: [
        "Partition active ready queue by disjoint write scopes.",
        "Dispatch parallel worker subagents simultaneously up to Work/Span headroom.",
        "Adopt continuous 1:1 pairing: validate immediately upon implementer submission.",
      ],
    });
  }

  if (qualityScore < 85) {
    breakthroughProposals.push({
      id: "PROP-QUAL-001",
      title: "Zero-Any Type Hardening & Counterfactual Probing",
      targetDimension: "higher_quality",
      rationale: "Untyped references or unproven gates weaken system guarantees and risk silent regressions.",
      firstPrinciplesAnalysis:
        "TypeScript's type checker provides zero-cost compile-time invariants when untyped escapes are eliminated.",
      estimatedSimplicityGain: "Self-documenting interfaces with total type safety",
      estimatedLatencyReduction: "Elimination of debugging cycles caused by runtime type mismatches",
      implementationPlan: [
        "Replace all `any` types with strict discriminated unions or type narrowing.",
        "Run `gate:prove` against disposable scratch copies to verify gate falsifiability.",
        "Mandate adversarial probe rounds before accepting validator passes.",
      ],
    });
  }

  const flavorProfile = COGNITIVE_FLAVOR_PROFILES[flavorId];

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
      lines.push("- Maintain infinite observe-only consciousness; synthesize radical simplifications for the full system topology.");
    } else if (role === "orchestrator") {
      lines.push("- Supervise execution rounds and eliminate cross-round redundant synthesis overhead.");
    } else if (role === "coordinator") {
      lines.push("- Expand concurrency to Work/Span math (P = W / S), eliminate serial bottlenecks, and enforce disjoint write scopes.");
    } else if (role === "implementer") {
      lines.push("- Enforce strict zero-any types, zero suppressions, and make minimal, elegant, context-sized changes.");
    } else if (role === "validator") {
      lines.push("- Execute adversarial falsification probes, verify gate failure paths, and demand quantitative DOM/screenshot proof.");
    }
  }

  return lines.join("\n").trim();
}

export function formatCognitiveEvaluationBrief(evaluation: CognitiveFlavorEvaluation): string {
  const lines: string[] = [];
  lines.push(`### 🧠 Cognitive Flavor Brief: ${evaluation.primaryFlavor}`);
  lines.push(`**Health Score:** ${evaluation.overallCognitiveHealthScore}/100 | **Findings:** ${evaluation.frictionFindings.length} | **Breakthroughs:** ${evaluation.breakthroughProposals.length}`);
  lines.push("");
  lines.push("**Dimensional Posture:**");
  for (const dim of COGNITIVE_DIMENSIONS) {
    const score = evaluation.dimensionScores[dim];
    lines.push(`- **${dim}**: ${score.score}/100 [${score.grade}] (${score.findingsCount} issue(s))`);
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
