/**
 * Tier 0 Mind Strategic Purpose & Proactive Cognition Engine.
 *
 * Codifies the foundational invariants of the Tier 0 Mind:
 * 1. Strategic Brain at 30,000 feet (macro-strategic consciousness overseeing architecture,
 *    direction, pulse cadence, multi-orchestrator scaling, and cross-generational continuity).
 * 2. The 3 Hard Zeros:
 *    - ZERO source code edits (never writes, edits, stages, reverts, formats, or deletes repository files).
 *    - ZERO unit test execution (never runs or executes unit test suites directly; delegated to implementers/validators).
 *    - ZERO critic jobs (never runs line-level reviews or critic passes; delegated to tier 2 reviewers/tier 3 critics).
 * 3. Proactive Subordinate Window Bandwidth Utilization:
 *    - During long subordinate execution windows (even 2+ hours), Mind actively uses its bandwidth for:
 *      a) Macro-level DAG diagnostics (Work/Span P = W / S, critical path analysis, bottleneck mitigations)
 *      b) Backlog grooming (feedback intake, dormant criteria reconciliation, strategic ranking)
 *      c) Candidate admission (pre-evaluating candidates against Charter goals and 6 Admission Gates)
 *      d) Proactive roadmap planning for future fleets (synthesizing upcoming waves ahead of time)
 */

export const MIND_STRATEGIC_ALTITUDE = "30,000 feet" as const;

export const MIND_HARD_ZEROS = {
  ZERO_SOURCE_CODE_EDITS: "zero_source_code_edits",
  ZERO_UNIT_TEST_EXECUTION: "zero_unit_test_execution",
  ZERO_CRITIC_JOBS: "zero_critic_jobs",
} as const;

export const MIND_PROACTIVE_BANDWIDTH_ACTIVITIES = [
  "macro_dag_diagnostics",
  "backlog_grooming",
  "candidate_admission",
  "proactive_roadmap_planning",
] as const;

export type MindProactiveBandwidthActivity = (typeof MIND_PROACTIVE_BANDWIDTH_ACTIVITIES)[number];

export interface MacroDagTaskNode {
  readonly taskId: string;
  readonly role: string;
  readonly status: "pending" | "ready" | "leased" | "completed" | "failed";
  readonly durationEstimateMs?: number | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[] | undefined;
}

export interface MacroDagBottleneck {
  readonly type: "critical_path" | "fan_in" | "fan_out" | "scope_lock" | "stale_lease";
  readonly taskId: string;
  readonly description: string;
  readonly suggestedMitigation: string;
}

export interface MacroDagDiagnosticResult {
  readonly totalNodes: number;
  readonly readyNodes: number;
  readonly leasedNodes: number;
  readonly completedNodes: number;
  readonly failedNodes: number;
  readonly criticalPathLength: number;
  readonly totalWorkMs: number;
  readonly criticalSpanMs: number;
  readonly workSpanRatio: number;
  readonly concurrencyRecommendation: number;
  readonly bottlenecks: readonly MacroDagBottleneck[];
  readonly subagentAllocations: Readonly<Record<string, number>>;
}

export interface BacklogGroomingItem {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly source: string;
  readonly status: "actionable" | "dormant" | "reconciled" | "pruned";
  readonly rationale?: string | undefined;
}

export interface BacklogGroomingResult {
  readonly scannedCount: number;
  readonly actionableCount: number;
  readonly dormantCount: number;
  readonly reconciledCount: number;
  readonly prunedCount: number;
  readonly items: readonly BacklogGroomingItem[];
  readonly strategicPriorities: readonly string[];
  readonly groomingSummary: string;
}

export interface StrategicCandidate {
  readonly id: string;
  readonly title: string;
  readonly objectiveStatement: string;
  readonly charterGoalIds: readonly string[];
  readonly writeScope: readonly string[];
  readonly witnessCommand?: string | undefined;
  readonly witnessOutput?: string | undefined;
  readonly falsifierCommand?: string | undefined;
}

export interface StrategicCandidateEvaluation {
  readonly candidateId: string;
  readonly title: string;
  readonly gate1Witnessed: boolean;
  readonly gate2InCharter: boolean;
  readonly gate3Falsifiable: boolean;
  readonly gate4DisjointScope: boolean;
  readonly gate5BudgetOk: boolean;
  readonly gate6NotDuplicate: boolean;
  readonly admitted: boolean;
  readonly failingGates: readonly number[];
  readonly decisionRationale: string;
  readonly assignedTier1Orchestrator?: string | undefined;
}

export interface StrategicCandidateAdmissionResult {
  readonly evaluatedCount: number;
  readonly admittedCount: number;
  readonly declinedCount: number;
  readonly evaluations: readonly StrategicCandidateEvaluation[];
  readonly summary: string;
}

export interface ProactiveWaveTask {
  readonly taskId: string;
  readonly description: string;
  readonly role: string;
  readonly estimatedDurationMs?: number | undefined;
}

export interface ProactiveWavePlan {
  readonly waveNumber: number;
  readonly title: string;
  readonly scopeDescription: string;
  readonly isolatedWriteScopes: readonly string[];
  readonly estimatedParallelism: number;
  readonly atomicTasks: readonly ProactiveWaveTask[];
}

export interface ProactiveRoadmapPlan {
  readonly fleetId: string;
  readonly plannedAt: string;
  readonly targetHorizonMs: number;
  readonly targetHorizonHours: number;
  readonly waves: readonly ProactiveWavePlan[];
  readonly totalTasks: number;
  readonly maxParallelism: number;
  readonly proactiveStrategy: string;
}

export interface ProactiveMindCognitionResult {
  readonly timestamp: string;
  readonly altitude: typeof MIND_STRATEGIC_ALTITUDE;
  readonly subordinateExecutionWindowMs: number;
  readonly subordinateExecutionWindowHours: number;
  readonly macroDag: MacroDagDiagnosticResult;
  readonly backlogGrooming: BacklogGroomingResult;
  readonly candidateAdmission: StrategicCandidateAdmissionResult;
  readonly proactiveRoadmap: ProactiveRoadmapPlan;
  readonly strategicSummary: string;
}

export interface MacroDagDiagnosticOptions {
  readonly nodes?: readonly MacroDagTaskNode[] | undefined;
  readonly runRoot?: string | undefined;
  readonly defaultTaskDurationMs?: number | undefined;
}

export interface BacklogGroomingOptions {
  readonly rawItems?: readonly Partial<BacklogGroomingItem>[] | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
}

export interface StrategicCandidateAdmissionOptions {
  readonly charterGoals?: readonly string[] | undefined;
  readonly activeScopes?: readonly string[] | undefined;
  readonly declinedIds?: readonly string[] | undefined;
  readonly maxAgentsInFlight?: number | undefined;
  readonly currentAgentsInFlight?: number | undefined;
}

export interface ProactiveRoadmapPlanningOptions {
  readonly fleetId?: string | undefined;
  readonly targetHorizonHours?: number | undefined;
  readonly admittedCandidates?: readonly StrategicCandidate[] | undefined;
  readonly backlogPriorities?: readonly string[] | undefined;
}

export interface ProactiveMindCognitionOptions {
  readonly subordinateExecutionWindowMs?: number | undefined;
  readonly nodes?: readonly MacroDagTaskNode[] | undefined;
  readonly rawBacklog?: readonly Partial<BacklogGroomingItem>[] | undefined;
  readonly candidates?: readonly StrategicCandidate[] | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly activeScopes?: readonly string[] | undefined;
  readonly declinedIds?: readonly string[] | undefined;
  readonly fleetId?: string | undefined;
  readonly targetHorizonHours?: number | undefined;
}
