import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { HarnessError } from "../../../../core/errors/index.ts";
import {
  isTestEnvironment,
  resolveCapsulesDir,
  resolveScratchDir,
} from "../../../../core/shared/paths.ts";
import {
  auditAdmissionDispatchIntegrity,
  drainPendingFeedbacks,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  updateOrPruneFeedbackItems,
  type AdmissionDispatchIntegrityReport,
  type AtomicAdmissionDispatchResult,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPriority,
  type FeedbackStatus,
} from "../../../feedback/queue/index.ts";
import { auditDefectLog } from "../../../defects/index.ts";
import {
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  type NewTaskQueueInput,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStats,
} from "../../queue/index.ts";
import {
  recordCompletedTask,
  recordCompletedTasksBatch,
  resolveCompletedTasksLedgerPath,
  type CompletedTaskRecord,
} from "../../../archival/completed/index.ts";
import {
  buildExactAnchorBriefing as buildExactAnchorBriefingCore,
  extractFileAnchors as extractFileAnchorsCore,
  extractFileSymbols as extractFileSymbolsCore,
  deriveRecommendedTestCommands as deriveRecommendedTestCommandsCore,
  formatExactAnchorBriefingMarkdown as formatExactAnchorBriefingMarkdownCore,
  type AnchorOptions,
  type AnchorSymbol,
  type AnchorSymbolKind,
  type ExactAnchor,
  type ExactAnchorBriefing as ExactAnchorBriefingCore,
  type ExactAnchorBriefingOptions as ExactAnchorBriefingCoreOptions,
} from "../../../proposals/builder/index.ts";
export {
  ARTIFICIAL_SERIALIZATION_WARNING,
  FALSE_SERIALIZATION_DEFECT,
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  type AntiSerializationInterlockResult,
  type ArtificialSerializationWarning,
  type CoordinatorPartition,
  type DecoupledGraphResult,
  type DecoupleOptions,
  type DynamicLanePartitioningResult,
  type HierarchyScalingPath,
  type HierarchyScalingResult,
  type MultiCoordinatorPartitionOptions,
  type MultiCoordinatorWavePartitionResult,
  type ParallelLaneAssignment,
  type ParallelMetrics,
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
  allocateParallelLanes,
  assertAntiSerializationInterlock,
  computeWorkSpanMetrics,
  decoupleDisjointTasks,
  detectArtificialSerialization,
  evaluateHierarchyScaling,
  formatParallelSubagentsDispatchArray,
  inferStackOrDomain,
  isFastPathCompactionEligible,
  partitionDynamicLanes,
  partitionWaveCoordinators,
  verifyAntiSerializationInterlock,
} from "../../../../graph/topology.ts";
export type { AnchorSymbolKind };

export type SmartTaskSourceType =
  | "feedback_intake"
  | "self_evolution"
  | "defect_remediation"
  | "direct_prompt"
  | "external_intake"
  | "plan_enhancement";

export interface ExactFileAnchor {
  readonly file_path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly symbol_name?: string | undefined;
  readonly symbol_kind?: AnchorSymbolKind | undefined;
  readonly context_snippet?: string | undefined;
  readonly replacement_anchor?: string | undefined;
  readonly ast_reference?: string | undefined;
  readonly token_count?: number | undefined;
}

export interface ExactAnchorBriefing {
  readonly task_id: string;
  readonly task_label: string;
  readonly write_scope: readonly string[];
  readonly target_files: readonly string[];
  readonly file_anchors: readonly ExactFileAnchor[];
  readonly recommended_test_commands: readonly string[];
  readonly gate_command: string;
  readonly acceptance_criteria: readonly string[];
  readonly rationale: string;
  readonly assigned_tier: string;
  readonly assigned_implementer?: string | undefined;
  readonly assigned_validator?: string | undefined;
  readonly zero_exploration_prompt: string;
  readonly async_wait_ms: number;
  readonly generated_at: string;
}

export interface ExactAnchorExtractionOptions {
  readonly rootDir?: string | undefined;
  readonly symbolHints?: readonly string[] | undefined;
  readonly maxSnippets?: number | undefined;
  readonly maxSnippetLines?: number | undefined;
}

export interface BuildExactAnchorBriefingOptions {
  readonly rootDir?: string | undefined;
  readonly symbolHints?: readonly string[] | undefined;
  readonly asyncWaitMs?: number | undefined;
  readonly runId?: string | undefined;
  readonly leaseTokenPlaceholder?: string | undefined;
}

export interface ActiveHypothesis {
  readonly id: string;
  readonly statement: string;
  readonly confidence: number;
  readonly status: "active" | "validated" | "refuted";
  readonly evidence: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RoadmapItem {
  readonly id: string;
  readonly title: string;
  readonly target_horizon: string;
  readonly milestones: readonly string[];
  readonly status: "active" | "completed" | "superseded";
}

export interface MacroMetrics {
  readonly work: number;
  readonly span: number;
  readonly parallelism: number; // P = W / S
  readonly efficiency: number;
}

export interface CognitiveMemoryState {
  readonly version: number;
  readonly last_updated: string;
  readonly strategic_focus: readonly string[];
  readonly active_hypotheses: readonly ActiveHypothesis[];
  readonly roadmaps: readonly RoadmapItem[];
  readonly macro_metrics?: MacroMetrics | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

export const CANONICAL_COGNITIVE_MEMORY_FILE = ".olt/memory.json";
export const DEFAULT_COGNITIVE_MEMORY_FILE = ".olt/memory.json";

export function resolveCanonicalCognitiveMemoryPath(customRoot?: string): string {
  const root =
    customRoot && customRoot.trim()
      ? resolve(customRoot.trim())
      : isTestEnvironment()
        ? resolveScratchDir()
        : process.cwd();
  return join(root, CANONICAL_COGNITIVE_MEMORY_FILE);
}

export function resolveCognitiveMemoryPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  return resolveCanonicalCognitiveMemoryPath();
}
