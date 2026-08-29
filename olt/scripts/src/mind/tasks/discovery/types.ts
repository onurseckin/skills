import type { DefectEntry } from "../../defects/index.ts";
import type { FeedbackItem } from "../../feedback/queue/index.ts";
import type {
  NewTaskQueueInput,
  TaskPriority,
  TaskQueueItem,
  TaskSourceType,
} from "../queue/index.ts";

export type { NewTaskQueueInput, TaskPriority, TaskQueueItem, TaskSourceType };
export type { DefectEntry, FeedbackItem };

export type DiscoveryCategory =
  | "CODE_QUALITY"
  | "TEST_COVERAGE"
  | "DORMANT_CRITERIA"
  | "COGNITIVE_GAP"
  | "FEEDBACK_INTAKE"
  | "DEFECT_REMEDIATION"
  | "ARCHITECTURAL_HEALTH"
  | "CONTINUOUS_HARDENING";
export type DiscoverySeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "BACKGROUND";
export type CodeQualityIssueType =
  | "TYPE_SAFETY_ANY"
  | "COMPILER_SUPPRESSION"
  | "LITERAL_FALLBACK"
  | "TODO_FIXME_MARKER"
  | "OVERSIZED_MODULE"
  | "UNEXPORTED_DEAD_CODE"
  | "DOCUMENTATION_DEFICIT";
export interface CodeQualityFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: CodeQualityIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}
export interface CodeQualityScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly maxLineThreshold?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}
export interface CodeQualityScanResult {
  readonly findings: readonly CodeQualityFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}
export type TestCoverageIssueType =
  | "MISSING_TEST_FILE"
  | "SKIPPED_TESTS"
  | "EMPTY_TEST_SUITE"
  | "LOW_ASSERTION_DENSITY";
export interface TestCoverageFinding {
  readonly sourceFile: string;
  readonly testFile?: string | undefined;
  readonly issueType: TestCoverageIssueType;
  readonly description: string;
  readonly suggestedRemediation: string;
  readonly severity: DiscoverySeverity;
}
export interface TestCoverageScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
}
export interface TestCoverageScanResult {
  readonly findings: readonly TestCoverageFinding[];
  readonly sourceFilesScanned: number;
  readonly testFilesScanned: number;
  readonly missingTestCount: number;
  readonly skippedTestCount: number;
  readonly durationMs: number;
}
export type CognitiveIssueType =
  | "COGNITIVE_COMPLEXITY"
  | "COGNITIVE_CHUNKING_OVERLOAD"
  | "UNHANDLED_BOUNDARY"
  | "UNBOUNDED_COLLECTION"
  | "MISSING_ERROR_RECOVERY"
  | "ASYNC_UNCAUGHT_BOUNDARY";
export interface CognitiveGapFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: CognitiveIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}
export interface CognitiveGapScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}
export interface CognitiveGapScanResult {
  readonly findings: readonly CognitiveGapFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}
export interface DormantCriteriaFinding {
  readonly criteriaId: string;
  readonly source:
    | "charter_goal"
    | "charter_stability"
    | "prompt_requirement"
    | "unverified_backlog";
  readonly statement: string;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}
export interface DormantCriteriaScanOptions {
  readonly charterPath?: string | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly recentTasksHistory?: readonly TaskQueueItem[] | undefined;
  readonly maxFindings?: number | undefined;
}
export interface DormantCriteriaScanResult {
  readonly findings: readonly DormantCriteriaFinding[];
  readonly goalsCheckedCount: number;
  readonly dormantCount: number;
  readonly durationMs: number;
}
export type ArchitecturalHealthIssueType =
  | "BROKEN_IMPORT"
  | "ORPHAN_MODULE"
  | "CIRCULAR_DEPENDENCY"
  | "MISSING_ARCHITECTURAL_FILE";
export interface ArchitecturalHealthFinding {
  readonly file: string;
  readonly line?: number | undefined;
  readonly issueType: ArchitecturalHealthIssueType;
  readonly description: string;
  readonly snippet?: string | undefined;
  readonly severity: DiscoverySeverity;
  readonly suggestedRemediation: string;
}
export interface ArchitecturalHealthScanOptions {
  readonly sourceRoots?: readonly string[] | undefined;
  readonly maxFindings?: number | undefined;
  readonly fileExtensions?: readonly string[] | undefined;
  readonly excludePatterns?: readonly string[] | undefined;
}
export interface ArchitecturalHealthScanResult {
  readonly findings: readonly ArchitecturalHealthFinding[];
  readonly filesScanned: number;
  readonly totalFindings: number;
  readonly durationMs: number;
}
export interface CandidateEvolutionProposal {
  readonly id: string;
  readonly kind: "proposal" | "defect";
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly targetFiles: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly charterGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly priority: TaskPriority;
  readonly sourceType: TaskSourceType;
  readonly estimatedEffort?: "SMALL" | "MEDIUM" | "LARGE" | undefined;
  readonly cognitiveDimension?: string | undefined;
}
export interface DiscoveryItem {
  readonly id: string;
  readonly category: DiscoveryCategory;
  readonly title: string;
  readonly description: string;
  readonly priority: TaskPriority;
  readonly targetFiles: readonly string[];
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly charterGoals: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly remediation: string;
  readonly sourceType: TaskSourceType;
  readonly sourceReference?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}
export interface DiscoveredTaskPlan {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly acceptance_criteria: readonly string[];
  readonly dependencies: readonly string[];
  readonly source_type: TaskSourceType;
  readonly priority: TaskPriority;
  readonly rationale: string;
  readonly assigned_tier:
    | "Tier_0_Mind"
    | "Tier_1_Orchestrator"
    | "Tier_2_Coordinator"
    | "Tier_3_Implementer"
    | "Tier_3_Validator";
  readonly assigned_implementer: string;
  readonly assigned_validator: string;
  readonly candidate_id?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}
export interface TaskDiscoveryOptions {
  readonly workspaceRoot?: string | undefined;
  readonly sourceRoots?: readonly string[] | undefined;
  readonly testRoots?: readonly string[] | undefined;
  readonly charterPath?: string | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly taskQueuePath?: string | undefined;
  readonly capsulesDir?: string | undefined;
  readonly maxTasks?: number | undefined;
  readonly enableCodeQualityScan?: boolean | undefined;
  readonly enableTestCoverageScan?: boolean | undefined;
  readonly enableCognitiveGapScan?: boolean | undefined;
  readonly enableDormantCriteriaScan?: boolean | undefined;
  readonly enableArchitecturalHealthScan?: boolean | undefined;
  readonly enableFeedbackQueueScan?: boolean | undefined;
  readonly enableDefectScan?: boolean | undefined;
  readonly autoEnqueue?: boolean | undefined;
  readonly actor?: string | undefined;
}
export interface TaskDiscoveryResult {
  readonly scannedAt: string;
  readonly findings: {
    readonly codeQuality: readonly CodeQualityFinding[];
    readonly testCoverage: readonly TestCoverageFinding[];
    readonly cognitiveGaps: readonly CognitiveGapFinding[];
    readonly dormantCriteria: readonly DormantCriteriaFinding[];
    readonly architecturalHealth: readonly ArchitecturalHealthFinding[];
    readonly feedbackPending: readonly FeedbackItem[];
    readonly openDefects: readonly DefectEntry[];
  };
  readonly discoveries: readonly DiscoveryItem[];
  readonly candidateProposals: readonly CandidateEvolutionProposal[];
  readonly synthesizedPlans: readonly DiscoveredTaskPlan[];
  readonly enqueuedTasks: readonly TaskQueueItem[];
  readonly stats: {
    readonly totalFindings: number;
    readonly codeQualityCount: number;
    readonly testCoverageCount: number;
    readonly cognitiveGapCount: number;
    readonly dormantCriteriaCount: number;
    readonly architecturalHealthCount: number;
    readonly feedbackCount: number;
    readonly defectCount: number;
    readonly synthesizedCount: number;
    readonly enqueuedCount: number;
  };
  readonly summary: string;
}
export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = [".ts", ".js", ".tsx", ".jsx"];
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  "node_modules",
  ".git",
  ".capsules",
  "dist",
  "build",
];
