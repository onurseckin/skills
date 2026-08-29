import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { isTestEnvironment, resolveScratchDir } from "../../../core/shared/paths.ts";

export type FeedbackPriority =
  | "CRITICAL_USER_FEEDBACK"
  | "HIGH_ARCHITECTURAL_FEATURE"
  | "USER_DIRECTIVE"
  | "NORMAL"
  | "LOW";

export type FeedbackStatus = "PENDING" | "ADMITTED" | "DECLINED" | "PROCESSED" | "COMPLETED";

export type FeedbackCategory =
  | "DOCUMENTATION"
  | "AGENT_CONTRACTS"
  | "CLI_TOOLING"
  | "WATCHDOG"
  | "SCALING"
  | "ARCHITECTURE"
  | "CORE_ENGINE"
  | "REPAIR"
  | "GENERAL"
  | "GOVERNANCE"
  | "ORCHESTRATION"
  | "AUDITING";

export interface FeedbackResolutionProof {
  readonly task_id: string;
  readonly resolved_at: string;
  readonly test_path?: string | null | undefined;
  readonly test_assertion?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly proof_summary?: string | null | undefined;
  readonly verified_by?: string | null | undefined;
  readonly remediation_notes?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FeedbackItem {
  readonly id: string;
  readonly timestamp: string;
  readonly priority: FeedbackPriority;
  readonly status: FeedbackStatus;
  readonly category: FeedbackCategory;
  readonly title: string;
  readonly content: string;
  readonly candidate_id?: string | null | undefined;
  readonly resolution_note?: string | null | undefined;
  readonly processed_at?: string | null | undefined;
  readonly resolution?: FeedbackResolutionProof | null | undefined;
  readonly test_path?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly commit_sha?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface FeedbackQueueStats {
  readonly total: number;
  readonly pending: number;
  readonly admitted: number;
  readonly declined: number;
  readonly processed: number;
  readonly completed: number;
}

export interface AtomicAdmissionDispatchResult {
  readonly feedback_item: FeedbackItem;
  readonly dispatched_task_id: string;
  readonly admitted_at: string;
  readonly auto_enqueued: boolean;
}

export interface AdmissionDispatchIntegrityReport {
  readonly is_compliant: boolean;
  readonly total_feedback_items: number;
  readonly admitted_feedback_count: number;
  readonly paused_admitted_feedback_count: number;
  readonly paused_admitted_feedbacks: readonly FeedbackItem[];
  readonly active_dispatched_feedback_count: number;
  readonly violations: readonly string[];
}

export interface BackpropagationRecord {
  readonly id: string;
  readonly commit_sha?: string | null | undefined;
  readonly proof_summary?: string | null | undefined;
  readonly completed_at?: string | null | undefined;
  readonly test_path?: string | null | undefined;
  readonly assertions?: number | string | readonly string[] | null | undefined;
  readonly runtime_ms?: number | string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly resolution?: FeedbackResolutionProof | null | undefined;
}

export const CANONICAL_FEEDBACK_FILE = "olt/backlog.jsonl";

export const DEFAULT_FEEDBACK_FILE = "olt/backlog.jsonl";

export const PRIORITY_ORDER: Record<FeedbackPriority, number> = {
  CRITICAL_USER_FEEDBACK: 1,
  HIGH_ARCHITECTURAL_FEATURE: 2,
  USER_DIRECTIVE: 3,
  NORMAL: 4,
  LOW: 5,
};

type FeedbackQueuePersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
let feedbackQueuePersistenceTestHook: ((stage: FeedbackQueuePersistenceStage) => void) | undefined;
const feedbackQueueLockSleep = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

/** @internal Narrow deterministic durability seam for the unit suite. */
export function __setFeedbackQueuePersistenceTestHook(
  hook: ((stage: FeedbackQueuePersistenceStage) => void) | undefined,
): void {
  feedbackQueuePersistenceTestHook = hook;
}

export function invokeFeedbackQueuePersistenceHook(stage: FeedbackQueuePersistenceStage): void {
  feedbackQueuePersistenceTestHook?.(stage);
}

export function noFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== "number")
    throw new HarnessError("UNSUPPORTED_PLATFORM", "feedback queue requires O_NOFOLLOW protection");
  return constants.O_NOFOLLOW;
}

export function resolveCanonicalFeedbackQueuePath(customRoot?: string, _useTodo = false): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return require("path").join(root, ".olt", "backlog.jsonl");
}

export function resolveFeedbackQueuePath(customPath?: string): string {
  if (customPath && customPath.trim()) return require("path").resolve(customPath.trim());
  return require("path").join(process.cwd(), ".olt", "backlog.jsonl");
}

export function compareFeedbackPriority(
  a: FeedbackItem | FeedbackPriority,
  b: FeedbackItem | FeedbackPriority,
): number {
  const priorityA = typeof a === "string" ? a : a.priority;
  const priorityB = typeof b === "string" ? b : b.priority;
  const rankA = PRIORITY_ORDER[priorityA] ?? 99;
  const rankB = PRIORITY_ORDER[priorityB] ?? 99;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (typeof a !== "string" && typeof b !== "string") {
    return a.timestamp.localeCompare(b.timestamp);
  }
  return 0;
}

export function sortFeedbackByPriority(items: readonly FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => compareFeedbackPriority(a, b));
}

export function validatePriority(val: unknown): FeedbackPriority {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "CRITICAL_USER_FEEDBACK" || upper === "CRITICAL") return "CRITICAL_USER_FEEDBACK";
    if (upper === "HIGH_ARCHITECTURAL_FEATURE" || upper === "HIGH")
      return "HIGH_ARCHITECTURAL_FEATURE";
    if (upper === "USER_DIRECTIVE" || upper === "DIRECTIVE") return "USER_DIRECTIVE";
    if (upper === "NORMAL" || upper === "MEDIUM") return "NORMAL";
    if (upper === "LOW") return "LOW";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid priority");
}

export function validateStatus(val: unknown): FeedbackStatus {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "PENDING") return "PENDING";
    if (upper === "ADMITTED") return "ADMITTED";
    if (upper === "DECLINED") return "DECLINED";
    if (upper === "PROCESSED") return "PROCESSED";
    if (upper === "COMPLETED") return "COMPLETED";
    if (upper === "PLANNED") return "ADMITTED";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid status");
}

export function validateCategory(val: unknown): FeedbackCategory {
  if (typeof val === "string") {
    const upper = val.toUpperCase();
    if (upper === "DOCUMENTATION") return "DOCUMENTATION";
    if (upper === "AGENT_CONTRACTS") return "AGENT_CONTRACTS";
    if (upper === "CLI_TOOLING") return "CLI_TOOLING";
    if (upper === "WATCHDOG") return "WATCHDOG";
    if (upper === "SCALING") return "SCALING";
    if (upper === "ARCHITECTURE") return "ARCHITECTURE";
    if (upper === "CORE_ENGINE") return "CORE_ENGINE";
    if (upper === "REPAIR") return "REPAIR";
    if (upper === "GENERAL") return "GENERAL";
    if (upper === "GOVERNANCE") return "GOVERNANCE";
    if (upper === "ORCHESTRATION") return "ORCHESTRATION";
    if (upper === "AUDITING") return "AUDITING";
  }
  throw new HarnessError("INTEGRITY", "Feedback item requires valid category");
}
