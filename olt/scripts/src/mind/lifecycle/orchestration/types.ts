/**
 * Type definitions for Mind Product Manager orchestration lifecycle,
 * Mode A (Autonomous Creative Product Manager) vs Mode B (External Intake),
 * candidate generation, and anti-stagnation metrics.
 */

import type { SmartTaskPlan } from "../../tasks/smart/planner/models.ts";
import type { TaskQueueItem } from "../../../task/queue/index.ts";
import type { FeedbackItem } from "../../feedback/queue/index.ts";

export type MindExecutionMode =
  | "MODE_A_CREATIVE_PRODUCT_MANAGER"
  | "MODE_B_EXTERNAL_INTAKE"
  | "QUEUE_ACTIVE_EXECUTION"
  | "IDLE_MONITORED";

export type CreativeEvolutionStep =
  | "step_1_baseline_quality"
  | "step_2_product_ux_audit"
  | "step_3_creative_ideation";

export interface GroundedFeatureProposal {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly charterGoals: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly acceptanceCriteria: readonly string[];
  readonly priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly rationale: string;
  readonly step: CreativeEvolutionStep;
  readonly estimatedEffort: number;
  readonly dependencies: readonly string[];
}

export interface AntiStagnationState {
  readonly consecutiveZeroDeltaCycles: number;
  readonly consecutiveMaintenanceCycles: number;
  readonly lastNonZeroProgressTimestamp: string;
  readonly isStagnant: boolean;
  readonly creativeStagnationDetected: boolean;
  readonly preplanningStagnationDetected: boolean;
  readonly activeHypothesisCount: number;
  readonly progressiveScore: number;
}

export interface ProductManagerEvaluationResult {
  readonly mode: MindExecutionMode;
  readonly reason: string;
  readonly queueCount: number;
  readonly feedbackCount: number;
  readonly openDefectsCount: number;
  readonly activeTasksCount: number;
  readonly antiStagnationState: AntiStagnationState;
  readonly recommendedAction: string;
  readonly nextCommand: string;
}

export interface ProductManagerExpansionResult {
  readonly mode: MindExecutionMode;
  readonly proposals: readonly GroundedFeatureProposal[];
  readonly synthesizedTasks: readonly SmartTaskPlan[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly antiStagnationState: AntiStagnationState;
  readonly cognitiveProgressLogged: boolean;
  readonly summary: string;
  readonly macroMetrics?:
    | {
        readonly work: number;
        readonly span: number;
        readonly idealConcurrency: number;
      }
    | undefined;
}

export interface MindProductManagerOptions {
  readonly repoRoot?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly queuePath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly memoryPath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly maxProposals?: number | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly orchestratorIds?: readonly string[] | undefined;
  readonly orchestratorCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}
