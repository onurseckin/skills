import type {
  CognitiveDirectiveDimension,
  CognitivePromptOptions,
  SocraticQuestion,
} from "./types.ts";

interface SocraticTemplate {
  readonly title: string;
  readonly strategicDirective: string;
  readonly questions: readonly SocraticQuestion[];
}

export const SOCRATIC_CATALOG: Record<CognitiveDirectiveDimension, SocraticTemplate> = {
  socratic_forensics: {
    title: "Root-Cause Forensics & First-Principles Interrogation",
    strategicDirective:
      "Interrogate underlying system assumptions, uncover unexamined failure causal chains, and replace speculative fixes with empirical proofs.",
    questions: [
      {
        dimension: "causal_depth",
        question:
          "What unverified assumption about state transitions, file boundaries, or tool protocols is currently taken for granted?",
        rationale:
          "Superficial fixes treat symptoms rather than eliminating systemic preconditions of failure.",
        falsificationCriterion:
          "Reproduce the state transition in a counterfactual test environment without the suspected assumption.",
      },
      {
        dimension: "negative_proof",
        question:
          "Can the target subsystem be proven broken by introducing an intentionally malformed input or edge boundary?",
        rationale:
          "A test suite that cannot fail when behavior is broken provides false confidence.",
        falsificationCriterion:
          "Assert exact error codes on empty, malformed, or out-of-order payloads.",
      },
      {
        dimension: "invariant_soundness",
        question:
          "Does every interface strictly enforce 0 'any' types, 0 suppressions, and fail-closed security invariants?",
        rationale: "Loose type casts allow corrupted runtime state to escape early detection.",
        falsificationCriterion:
          "Execute full compiler type checks with zero suppression allowances.",
      },
    ],
  },
  anti_stagnation_intervention: {
    title: "Anti-Stagnation & Autonomous Exploration Catalyst",
    strategicDirective:
      "Break repetitive idle loops and quiescent stalls by immediately transitioning into proactive discovery, architecture hardening, or defect eradication.",
    questions: [
      {
        dimension: "idle_loop_destruction",
        question:
          "Why has the active execution stream produced zero state deltas across consecutive cycles?",
        rationale:
          "Monotone idle checks conceal latent blockers and waste scheduling opportunities.",
        falsificationCriterion:
          "Identify the exact bottleneck preventing task admission or progress logging.",
      },
      {
        dimension: "unmet_demand_discovery",
        question:
          "What high-leverage product capability or developer workflow improvement remains unadmitted in the backlog?",
        rationale:
          "An empty active queue is an explicit mandate for creative product management exploration.",
        falsificationCriterion:
          "Discover and admit concrete, grounded feature vectors directly enhancing repository leverage.",
      },
      {
        dimension: "defect_sweeping",
        question:
          "Are historical defects from previous runs properly verified as permanently impossible in current code?",
        rationale:
          "Defects recur unless regression barriers are systematically hardened in test suites.",
        falsificationCriterion:
          "Cross-reference recent defect ledgers against current test suite coverage.",
      },
    ],
  },
  multi_step_execution: {
    title: "Structured Multi-Step Actionable Execution",
    strategicDirective:
      "Decompose complex implementation and audit goals into atomic, verifiable sub-steps with explicit proof requirements.",
    questions: [
      {
        dimension: "step_atomicity",
        question:
          "Is the current execution step strictly confined to its assigned write scope and atomic milestone?",
        rationale:
          "Unbounded wide edits increase merge conflicts and violate task confinement invariants.",
        falsificationCriterion:
          "Verify that git status confirms 100% of modified files lie within the task write scope.",
      },
      {
        dimension: "verification_rigor",
        question:
          "What deterministic command confirms the correctness of this step before proceeding to subsequent phases?",
        rationale: "Progress claimed without empirical gate execution is unevidenced.",
        falsificationCriterion:
          "Run the exact file-scoped test suite and capture passing assertions on stdout.",
      },
      {
        dimension: "rollback_safety",
        question:
          "If this step fails midway, is the working tree cleanly recoverable to a known good state?",
        rationale: "Unstaged dirty states prevent fast recovery and cause cascading failures.",
        falsificationCriterion:
          "Ensure transactional state mutations are backed by snapshot restore mechanisms.",
      },
    ],
  },
  context_loss_prevention: {
    title: "Context Refresh & Cognitive Anchor Preservation",
    strategicDirective:
      "Anchor the agent's reasoning against long-horizon drift, ensuring task goals, topological dependencies, and hard invariants remain sharp.",
    questions: [
      {
        dimension: "horizon_drift",
        question:
          "What is the precise ultimate deliverable of the current task wave, and how does the current step advance it?",
        rationale:
          "Subagents in extended loops lose sight of top-level acceptance criteria without explicit refresh anchors.",
        falsificationCriterion:
          "Re-evaluate current diff against the original requirement specification lines.",
      },
      {
        dimension: "dependency_topology",
        question:
          "Which downstream tasks depend on the artifacts and exported symbols being constructed right now?",
        rationale:
          "Breaking public module facades breaks parallel and wave-2 downstream workers.",
        falsificationCriterion:
          "Check exported interfaces and directory index facades for complete backward compatibility.",
      },
      {
        dimension: "role_confinement",
        question:
          "Is the agent operating strictly within its designated role contract and tier authority level?",
        rationale:
          "Supervisors must not perform edits directly, and workers must not usurp coordinator duties.",
        falsificationCriterion:
          "Verify caller session grant permissions and role confinement rules.",
      },
    ],
  },
  adversarial_robustness: {
    title: "Adversarial Falsification & Negative Proof Verification",
    strategicDirective:
      "Subject hypotheses, parser schemas, and state guards to adversarial inputs, corrupted structures, and boundary extremes.",
    questions: [
      {
        dimension: "adversarial_tampering",
        question:
          "How does the subsystem behave when supplied with malicious tokens, mismatched hashes, or malformed payloads?",
        rationale: "Robust systems must fail closed with deterministic, categorized error codes.",
        falsificationCriterion:
          "Execute negative counterfactual tests ensuring unauthorized access is rejected with code 3.",
      },
      {
        dimension: "concurrency_mutation",
        question:
          "Can concurrent file operations or parallel subagents induce race conditions or lock starvation?",
        rationale:
          "Distributed file locks and state updates must maintain transactional serializability.",
        falsificationCriterion:
          "Simulate parallel lock acquisition and atomic write-then-rename operations under contention.",
      },
    ],
  },
  architecture_simplification: {
    title: "First-Principles Architectural Pruning & Modularity",
    strategicDirective:
      "Eliminate redundant indirection, dead code paths, and leaky abstraction layers to minimize cognitive complexity and token footprint.",
    questions: [
      {
        dimension: "indirection_pruning",
        question:
          "Can multiple pass-through helper layers be collapsed into a single, cohesive, highly readable module?",
        rationale:
          "Over-abstraction degrades developer navigation and bloats context windows without adding value.",
        falsificationCriterion:
          "Measure LOC reduction and verify all unit tests pass with zero behavior regressions.",
      },
      {
        dimension: "facade_encapsulation",
        question:
          "Are all internal implementation details shielded behind clean directory index facades?",
        rationale:
          "Deep cross-subsystem imports create tangled dependencies that break modular refactoring.",
        falsificationCriterion:
          "Audit cross-directory import statements for direct index file references.",
      },
    ],
  },
  product_manager_innovation: {
    title: "Autonomous Product Manager Value Expansion",
    strategicDirective:
      "Think like a visionary Principal Product Engineer: identify high-leverage DX/UX vectors, uncover latent gaps, and expand repository value.",
    questions: [
      {
        dimension: "product_leverage",
        question:
          "What capability would double developer throughput or make complex orchestration completely effortless?",
        rationale:
          "Autonomous agents must actively invent high-value features rather than merely maintaining baseline health.",
        falsificationCriterion:
          "Formulate and admit an innovative, grounded capability task via mind:admit.",
      },
      {
        dimension: "user_experience_polish",
        question:
          "Are CLI diagnostics, error remediation hints, and progress reports crystal clear, actionable, and beautiful?",
        rationale:
          "Exceptional developer experience requires informative ASCII badges, concise summaries, and unambiguous next steps.",
        falsificationCriterion:
          "Review formatted CLI and chat outputs for clarity, readability, and visual elegance.",
      },
    ],
  },
  token_latency_optimization: {
    title: "Token Parsimony & Low-Latency Execution",
    strategicDirective:
      "Compress diagnostic briefings, eliminate repetitive prompt boilerplate, and accelerate disk/process execution times.",
    questions: [
      {
        dimension: "context_compression",
        question:
          "Can prompt payloads be compressed by removing redundant text while preserving 100% of actionable guidance?",
        rationale:
          "Excessive tokens increase LLM latency and risk hitting rate limits or attention dilution.",
        falsificationCriterion:
          "Benchmark token counts before and after compression templates.",
      },
      {
        dimension: "execution_speed",
        question:
          "Are disk reads, subprocess spawns, and git queries optimized to complete in minimal wall-clock time?",
        rationale: "Fast scheduler loops allow high-frequency feedback without latency bottlenecks.",
        falsificationCriterion:
          "Verify execution times remain well within the 5-minute single-task SLA boundary.",
      },
    ],
  },
};

export function selectSocraticQuestions(
  dimension: CognitiveDirectiveDimension,
  options: CognitivePromptOptions = {},
): readonly SocraticQuestion[] {
  const template = SOCRATIC_CATALOG[dimension] ?? SOCRATIC_CATALOG.socratic_forensics;
  const cycle = options.cycleIndex ?? options.tickNumber ?? 0;
  const questions = template.questions;

  if (questions.length <= 2) {
    return questions;
  }

  // Non-monotone variance: rotate questions based on cycle counter
  const offset = cycle % questions.length;
  const rotated = [...questions.slice(offset), ...questions.slice(0, offset)];
  return rotated.slice(0, 3);
}
