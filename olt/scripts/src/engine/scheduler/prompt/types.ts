export type CognitiveDirectiveDimension =
  | "socratic_forensics"
  | "anti_stagnation_intervention"
  | "multi_step_execution"
  | "context_loss_prevention"
  | "adversarial_robustness"
  | "architecture_simplification"
  | "product_manager_innovation"
  | "token_latency_optimization";

export const COGNITIVE_DIRECTIVE_DIMENSIONS: readonly CognitiveDirectiveDimension[] = [
  "socratic_forensics",
  "anti_stagnation_intervention",
  "multi_step_execution",
  "context_loss_prevention",
  "adversarial_robustness",
  "architecture_simplification",
  "product_manager_innovation",
  "token_latency_optimization",
] as const;

export interface SocraticQuestion {
  readonly question: string;
  readonly dimension: string;
  readonly rationale: string;
  readonly falsificationCriterion?: string | undefined;
}

export interface CognitiveStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly action: string;
  readonly requiredProof: string;
  readonly forbiddenShortcuts?: readonly string[] | undefined;
}

export interface AntiStagnationTrigger {
  readonly triggerCondition: string;
  readonly severity: "warning" | "critical" | "emergency";
  readonly imperativeAction: string;
  readonly shockMechanism: string;
}

export interface ContextAnchor {
  readonly category: "topology" | "lease" | "defects" | "gates" | "model_tier" | "invariant";
  readonly title: string;
  readonly detail: string;
}

export interface CognitiveProbingDirective {
  readonly id: string;
  readonly tickNumber: number;
  readonly cycleIndex: number;
  readonly dimension: CognitiveDirectiveDimension;
  readonly title: string;
  readonly strategicDirective: string;
  readonly socraticQuestions: readonly SocraticQuestion[];
  readonly steps: readonly CognitiveStep[];
  readonly actionableImperatives: readonly string[];
  readonly antiStagnationTriggers: readonly AntiStagnationTrigger[];
  readonly contextAnchors: readonly ContextAnchor[];
  readonly generatedAt: string;
  readonly formattedMarkdown: string;
}

export interface CognitivePromptOptions {
  readonly tickNumber?: number | undefined;
  readonly cycleIndex?: number | undefined;
  readonly state?: Record<string, unknown> | undefined;
  readonly zeroValueStreak?: number | undefined;
  readonly stagnant?: boolean | undefined;
  readonly activeTasks?: readonly string[] | undefined;
  readonly readyTasks?: readonly string[] | undefined;
  readonly blockedTasks?: readonly string[] | undefined;
  readonly recentErrors?: readonly string[] | undefined;
  readonly preferredDimension?: CognitiveDirectiveDimension | undefined;
  readonly host?: string | undefined;
  readonly modelTier?: string | undefined;
  readonly thinkingLevel?: string | undefined;
  readonly repoRoot?: string | undefined;
}
