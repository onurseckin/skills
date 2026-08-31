import { existsSync, readFileSync } from "node:fs";
import { resolveDefectsPath } from "../../../core/shared/paths.ts";

export type CognitiveChallengeDimension =
  | "ui_ux_exploration"
  | "radical_simplification"
  | "performance_token_efficiency"
  | "adversarial_robustness"
  | "charter_evolution"
  | "modularity_type_invariants";

export const COGNITIVE_CHALLENGE_DIMENSIONS: readonly CognitiveChallengeDimension[] = [
  "ui_ux_exploration",
  "radical_simplification",
  "performance_token_efficiency",
  "adversarial_robustness",
  "charter_evolution",
  "modularity_type_invariants",
] as const;

export interface CognitiveChallenge {
  readonly dimension: CognitiveChallengeDimension;
  readonly title: string;
  readonly directive: string;
  readonly questions: readonly string[];
  readonly actionItems: readonly string[];
  readonly cycleIndex: number;
  readonly generatedAt: string;
  readonly seedContext?: string | undefined;
}

export interface CognitiveChallengeOptions {
  readonly repoRoot?: string | undefined;
  readonly cycleIndex?: number | undefined;
  readonly consecutiveZeroDeltaCount?: number | undefined;
  readonly idleDurationSeconds?: number | undefined;
  readonly timestamp?: string | undefined;
  readonly preferredDimension?: CognitiveChallengeDimension | undefined;
  readonly recentDefectCount?: number | undefined;
}

export interface ZeroDeltaChallengeOptions {
  readonly cycleIndex?: number | undefined;
  readonly consecutiveZeroDeltaCount?: number | undefined;
  readonly now?: string | undefined;
}

interface DimensionTemplate {
  readonly title: string;
  readonly directive: string;
  readonly questions: readonly string[];
  readonly actionItems: readonly string[];
}

const DIMENSION_TEMPLATES: Record<CognitiveChallengeDimension, DimensionTemplate> = {
  ui_ux_exploration: {
    title: "Continuous UI/UX & Browser Interaction Exploration",
    directive:
      "Explore unaddressed application views, edge-case user interaction flows, and responsive viewport states.",
    questions: [
      "Are all primary and secondary user flows verified across 4 responsive viewports (mobile, tablet, desktop, wide)?",
      "Do interactive elements handle error states, network delays, and boundary data gracefully?",
      "Are visual regressions and layout shifts prevented with quantitative DOM/screenshot proofs?",
    ],
    actionItems: [
      "Inspect frontend routes and interactive components for missing visual edge cases.",
      "Formulate exploratory user journey scenarios with diverse persona permissions.",
      "Admit a high-priority UX improvement candidate task via mind:admit.",
    ],
  },
  radical_simplification: {
    title: "Radical First-Principles Simplification & Code Pruning",
    directive:
      "Eliminate unnecessary abstraction layers, ceremony, dead code, and redundant wrappers across the codebase.",
    questions: [
      "Can complex layered services be collapsed into concise, context-sized single modules?",
      "Are there unused helper functions, dead branches, or redundant configuration files?",
      "Does every line of code directly serve domain correctness and performance?",
    ],
    actionItems: [
      "Perform a codebase pass identifying over-engineered abstractions and redundant indirection.",
      "Propose simplification refactors that decrease physical LOC while improving readability.",
      "Admit a code pruning task via mind:admit.",
    ],
  },
  performance_token_efficiency: {
    title: "Performance Optimization & Token Parsimony",
    directive:
      "Optimize runtime throughput, memory footprint, and subagent prompt token consumption.",
    questions: [
      "Can repetitive diagnostic briefings be compressed with zero loss of actionable guidance?",
      "Are subagent dispatch prompts minimal and anchor-exact to prevent context bloating?",
      "Where are disk I/O and CLI execution bottlenecks that can be accelerated?",
    ],
    actionItems: [
      "Audit subagent prompt construction templates to eliminate repetitive boilerplate.",
      "Benchmark test suite and harness command runtimes to isolate latency spikes.",
      "Admit a performance or token-efficiency enhancement task via mind:admit.",
    ],
  },
  adversarial_robustness: {
    title: "Adversarial Falsification & Negative Gate Verification",
    directive:
      "Challenge system assumptions with counterfactual inputs, negative assertions, and stress tests.",
    questions: [
      "Can existing test suites be bypassed by counterfeit data or tampered signatures?",
      "Do gate verification commands legitimately fail when breaking changes are introduced?",
      "Are concurrency race conditions and concurrent file lock collisions handled safely?",
    ],
    actionItems: [
      "Construct negative test cases that verify failure paths reject invalid states with exact codes.",
      "Subject core state machines to concurrent stress probes.",
      "Admit an adversarial hardening task via mind:admit.",
    ],
  },
  charter_evolution: {
    title: "Charter Goal Fulfillment & Forward Feature Roadmap Synthesis",
    directive:
      "Audit high-level Charter milestones and synthesize autonomous forward-looking capabilities.",
    questions: [
      "Which strategic charter objectives remain partially fulfilled or unaddressed?",
      "What new autonomous capabilities would significantly elevate repository productivity?",
      "How can historical blunders from .olt/defects.jsonl be rendered permanently impossible?",
    ],
    actionItems: [
      "Compare active system features against .olt/charter.yaml and backlog history.",
      "Synthesize an innovative next-generation capability proposal.",
      "Admit a forward roadmap task via mind:admit.",
    ],
  },
  modularity_type_invariants: {
    title: "Strict Type Invariants & Facade Modularity",
    directive:
      "Enforce zero 'any' types, zero compiler suppressions, and strict directory index encapsulation.",
    questions: [
      "Are all internal symbols cleanly exported through module index facades?",
      "Are runtime types validated with strict TypeScript schemas rather than loose casts?",
      "Are circular dependencies or implicit cross-boundary couplings present?",
    ],
    actionItems: [
      "Audit source files for schema precision and strict return types.",
      "Ensure all cross-subsystem imports target directory index facades.",
      "Admit a type safety and modularity task via mind:admit.",
    ],
  },
};

export class CognitiveChallengePromptGenerator {
  public static generateCognitiveChallenge(
    options: CognitiveChallengeOptions = {},
  ): CognitiveChallenge {
    const cycle =
      options.consecutiveZeroDeltaCount !== undefined
        ? options.consecutiveZeroDeltaCount
        : options.cycleIndex !== undefined
          ? options.cycleIndex
          : 0;

    const chosenDimension: CognitiveChallengeDimension =
      options.preferredDimension !== undefined
        ? options.preferredDimension
        : COGNITIVE_CHALLENGE_DIMENSIONS[cycle % COGNITIVE_CHALLENGE_DIMENSIONS.length] !==
            undefined
          ? (COGNITIVE_CHALLENGE_DIMENSIONS[
              cycle % COGNITIVE_CHALLENGE_DIMENSIONS.length
            ] as CognitiveChallengeDimension)
          : "ui_ux_exploration";

    const template = DIMENSION_TEMPLATES[chosenDimension];
    const timestamp =
      options.timestamp !== undefined ? options.timestamp : new Date().toISOString();

    let seedContext: string | undefined = undefined;
    if (options.repoRoot !== undefined) {
      const defectsPath = resolveDefectsPath(options.repoRoot);
      if (existsSync(defectsPath)) {
        try {
          const content = readFileSync(defectsPath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim().length > 0);
          if (lines.length > 0) {
            seedContext = `Repository contains ${lines.length} historical defect record(s).`;
          }
        } catch {
          // Ignore read errors for seed context
        }
      }
    }

    return {
      dimension: chosenDimension,
      title: template.title,
      directive: template.directive,
      questions: template.questions,
      actionItems: template.actionItems,
      cycleIndex: cycle,
      generatedAt: timestamp,
      seedContext,
    };
  }

  public static formatCognitiveChallengePrompt(challenge: CognitiveChallenge): string {
    const lines: string[] = [];
    lines.push("================================================================================");
    lines.push(`🧠 COGNITIVE CHALLENGE PROMPT: ${challenge.title.toUpperCase()}`);
    lines.push(
      `[Dimension: ${challenge.dimension} | Cycle: ${challenge.cycleIndex} | Generated: ${challenge.generatedAt}]`,
    );
    lines.push("================================================================================");
    lines.push("");
    lines.push("⚡ INVARIANT MANDATE: CLOSING_FORBIDDEN_FOR_MIND & INFINITE_MIND_CADENCE");
    lines.push("The Mind agent MUST NOT transition to idle state or terminate upon empty queue.");
    lines.push("Continuous creative ideation, UX exploration, and code evolution are mandatory.");
    lines.push("");
    lines.push(`🎯 Strategic Directive:\n${challenge.directive}`);
    lines.push("");
    lines.push("🔍 Reflexive Self-Questioning Inquiries:");
    for (const q of challenge.questions) {
      lines.push(`  - ${q}`);
    }
    lines.push("");
    lines.push("🚀 Immediate Actionable Mandates:");
    for (const a of challenge.actionItems) {
      lines.push(`  1. ${a}`);
    }
    if (challenge.seedContext !== undefined) {
      lines.push("");
      lines.push(`📌 Repository Context: ${challenge.seedContext}`);
    }
    lines.push("");
    lines.push("================================================================================");
    lines.push(
      "Execute continuous discovery now: invoke `mind:admit` or explore next feature vectors.",
    );
    return lines.join("\n");
  }

  public static generateZeroDeltaChallengePrompt(
    repoRoot: string,
    options: ZeroDeltaChallengeOptions = {},
  ): string {
    const challenge = this.generateCognitiveChallenge({
      repoRoot,
      cycleIndex: options.cycleIndex,
      consecutiveZeroDeltaCount: options.consecutiveZeroDeltaCount,
      timestamp: options.now,
    });
    return this.formatCognitiveChallengePrompt(challenge);
  }
}

export function generateCognitiveChallengePrompt(options: CognitiveChallengeOptions = {}): string {
  const challenge = CognitiveChallengePromptGenerator.generateCognitiveChallenge(options);
  return CognitiveChallengePromptGenerator.formatCognitiveChallengePrompt(challenge);
}

export function generateZeroDeltaChallengePrompt(
  repoRoot: string,
  options: ZeroDeltaChallengeOptions = {},
): string {
  return CognitiveChallengePromptGenerator.generateZeroDeltaChallengePrompt(repoRoot, options);
}
