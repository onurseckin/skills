/**
 * Hyper-Active Mind Cognition & Proactive Plan Enhancer Engine.
 *
 * Implements continuous autonomous cognitive audit loops, proactive self-questioning cycles,
 * plan enhancement harvesting during Mind pulses, optimization proposal generation,
 * multidimensional cognitive score tracking, and seamless pulse cadence integration.
 *
 * Core Invariant: Mind must never idle; hyper-active cognition autonomously audits,
 * questions, harvests enhancements, and drives perpetual execution.
 *
 * ZERO `any` types, ZERO defaulted literal fallback operators (`??`, `||`).
 */

import { HarnessError } from "../../../core/errors/index.ts";

import type { HarnessEvent, RunState } from "../../../core/contracts/index.ts";

import type { JsonObject, JsonValue } from "../../../core/contracts/index.ts";

import { isRecord, isNonblank, isInteger } from "../../../requirements/predicates.ts";

import {
  COGNITIVE_DIMENSIONS,
  type CognitiveDimension,
  CANONICAL_SELF_QUESTIONING_QUESTION,
} from "../../cognitive-flavor.ts";


export const HYPER_COGNITION_VERSION = "gen3_hyper_active_v1" as const;

export const MIND_NEVER_IDLE_MANTRA =
  "Mind must never idle; hyper-active cognition autonomously audits, questions, and enhances the execution plane." as const;


export const MIN_COGNITIVE_SCORE = 0;

export const MAX_COGNITIVE_SCORE = 100;

export const DEFAULT_HYPER_AUDIT_INTERVAL_MS = 300_000;
 // 5 minutes

export type CognitiveAuditDimension =
  | "simplicity"
  | "performance"
  | "observability"
  | "type_safety"
  | "ast_purity"
  | "dag_concurrency";


export const COGNITIVE_AUDIT_DIMENSIONS: readonly CognitiveAuditDimension[] = [
  "simplicity",
  "performance",
  "observability",
  "type_safety",
  "ast_purity",
  "dag_concurrency",
] as const;


export type CognitiveAuditSeverity = "critical" | "warning" | "advisory" | "opportunity";


export interface CognitiveAuditFinding {
  readonly id: string;
  readonly dimension: CognitiveAuditDimension;
  readonly severity: CognitiveAuditSeverity;
  readonly ruleId: string;
  readonly targetPath?: string | undefined;
  readonly description: string;
  readonly remediation: string;
  readonly scoreImpact: number;
  readonly timestamp: string;
}


export interface CognitiveAuditResult {
  readonly passed: boolean;
  readonly score: number;
  readonly findings: readonly CognitiveAuditFinding[];
  readonly auditedTasksCount: number;
  readonly auditedFilesCount: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly advisoryCount: number;
  readonly opportunityCount: number;
  readonly evaluatedAt: string;
}


export interface ProactiveQuestionSpec {
  readonly id: string;
  readonly dimension: CognitiveAuditDimension;
  readonly flavorDimension: CognitiveDimension;
  readonly question: string;
  readonly probeTarget: string;
  readonly defaultHypothesis: string;
}


export const PROACTIVE_QUESTION_CATALOG: readonly ProactiveQuestionSpec[] = [
  {
    id: "PQ-SIMPLICITY-1",
    dimension: "simplicity",
    flavorDimension: "simpler",
    question:
      "Can redundant intermediate states or superfluous abstractions be eliminated without losing fidelity?",
    probeTarget: "graph_architecture",
    defaultHypothesis:
      "Intermediate coordination buffers might be compressible into direct pipeline edges.",
  },
  {
    id: "PQ-PERFORMANCE-1",
    dimension: "performance",
    flavorDimension: "faster",
    question:
      "Are independent execution chains serialized unnecessarily due to false write-scope barriers?",
    probeTarget: "critical_path",
    defaultHypothesis: "Parallel task branches can run concurrently across distinct worker lanes.",
  },
  {
    id: "PQ-OBSERVABILITY-1",
    dimension: "observability",
    flavorDimension: "more_visual",
    question:
      "Does every state transition produce unambiguous structured telemetry and telemetry-bound evidence?",
    probeTarget: "event_stream",
    defaultHypothesis:
      "High-level state changes require fine-grained event payloads with complete causal links.",
  },
  {
    id: "PQ-TYPE_SAFETY-1",
    dimension: "type_safety",
    flavorDimension: "higher_quality",
    question:
      "Are there untyped structures, unsafe casts, or unvalidated boundaries masking integrity defects?",
    probeTarget: "type_contracts",
    defaultHypothesis:
      "Strict type guards and discriminated unions will catch runtime invariant violations at compile time.",
  },
  {
    id: "PQ-AST_PURITY-1",
    dimension: "ast_purity",
    flavorDimension: "more_token_efficient",
    question:
      "Are fallback operators (??, ||) silently masking undefined/null values instead of explicit assertions?",
    probeTarget: "source_ast",
    defaultHypothesis:
      "AST linter rules can enforce zero-fallback purity and explicit branching repository-wide.",
  },
  {
    id: "PQ-DAG_CONCURRENCY-1",
    dimension: "dag_concurrency",
    flavorDimension: "better",
    question:
      "Is task fan-out constrained by artificially wide write scopes that could be decomposed?",
    probeTarget: "task_decomposition",
    defaultHypothesis:
      "Splitting wide-scope tasks into isolated atomic units maximizes wave concurrency.",
  },
] as const;


export interface OptimizationProposal {
  readonly id: string;
  readonly title: string;
  readonly dimension: CognitiveAuditDimension;
  readonly expectedBenefit: string;
  readonly riskAssessment: "low" | "medium" | "high";
  readonly targetFiles: readonly string[];
  readonly suggestedPatch?: string | undefined;
  readonly scoreBoost: number;
  readonly status: "proposed" | "accepted" | "rejected" | "implemented";
  readonly createdAt: string;
}


export interface ProactiveQuestionCycle {
  readonly cycleId: string;
  readonly questionId: string;
  readonly questionText: string;
  readonly dimension: CognitiveAuditDimension;
  readonly flavorDimension: CognitiveDimension;
  readonly hypothesis: string;
  readonly investigationFindings: readonly string[];
  readonly synthesizedProposals: readonly OptimizationProposal[];
  readonly evaluatedAt: string;
}


export interface DiscoveredSubtask {
  readonly taskId: string;
  readonly title: string;
  readonly writeScope: readonly string[];
  readonly gateCommand: string;
  readonly dependencies: readonly string[];
  readonly estimatedEffort: number;
  readonly rationale: string;
}


export interface PlanEnhancementHarvest {
  readonly harvestId: string;
  readonly pulseId: string;
  readonly sourceTaskIds: readonly string[];
  readonly enhancedCriteria: readonly string[];
  readonly suggestedSubtasks: readonly DiscoveredSubtask[];
  readonly identifiedBottlenecks: readonly string[];
  readonly parallelizableLanes: readonly string[];
  readonly harvestedAt: string;
  readonly applied: boolean;
}


export interface CognitiveScoreVector {
  readonly simplicityScore: number;
  readonly performanceScore: number;
  readonly observabilityScore: number;
  readonly typeSafetyScore: number;
  readonly astPurityScore: number;
  readonly dagConcurrencyScore: number;
  readonly compositeScore: number;
  readonly evaluatedAt: string;
}


export type CadenceHyperAction =
  | "IMMEDIATE_ROLLOVER"
  | "SYNTHESIZE_TASKS"
  | "AUDIT_DAG"
  | "PROACTIVE_REPLAN"
  | "STEADY_EXECUTION";


export interface HyperCognitivePulseReport {
  readonly pulseId: string;
  readonly pulseTimestamp: string;
  readonly activeQuestions: readonly ProactiveQuestionCycle[];
  readonly auditResult: CognitiveAuditResult;
  readonly harvestedEnhancements: readonly PlanEnhancementHarvest[];
  readonly proposals: readonly OptimizationProposal[];
  readonly scoreVector: CognitiveScoreVector;
  readonly cadenceAction: CadenceHyperAction;
  readonly rationale: string;
}
