/**
 * Unified Innovative Mind Cognition & Self-Questioning Flavor Subsystem.
 * Implements first-principles cognitive evaluation, reflexive self-questioning loops,
 * cognitive flavor personas, breakthrough opportunity synthesis, and prompt formatting.
 *
 * Core Mantra: "How can this system be made simpler, better, faster, more visual,
 * more token-efficient, and higher quality?"
 */

import { HarnessError } from "../../../core/errors/index.ts";
import {
  COGNITIVE_PILLARS,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
  getCognitivePillar,
} from "../../../authority/pillars.ts";

export interface CognitiveSelfQuestioningFramework {
  readonly canonicalQuestion: string;
  readonly dimensions: readonly CognitiveDimension[];
  readonly specs: Readonly<Record<CognitiveDimension, CognitiveDimensionSpec>>;
}

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

export const COGNITIVE_DIMENSION_SPECS: Readonly<
  Record<CognitiveDimension, CognitiveDimensionSpec>
> = {
  simpler: {
    dimension: "simpler",
    title: "Radical Simplification & Abstraction Pruning",
    coreQuestion:
      "How can this system be made simpler by eliminating accidental complexity and ceremonial bloat?",
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
    coreQuestion:
      "How can this system be made better through tighter contracts, cleaner boundaries, and stronger guarantees?",
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
    coreQuestion:
      "How can this system be made faster by maximizing parallelism ($P = W / S$) and removing serial bottlenecks?",
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
    coreQuestion:
      "How can this system be made more visual through rich ASCII/Unicode DAG graphs and quantitative proof?",
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
    coreQuestion:
      "How can this system be made more token-efficient to eliminate context bloat and prevent compaction?",
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
    coreQuestion:
      "How can this system be made higher quality with zero untyped code and falsifiable verification gates?",
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
