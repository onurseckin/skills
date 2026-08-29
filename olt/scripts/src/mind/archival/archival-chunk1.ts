import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";

import { randomBytes } from "node:crypto";

import { basename, dirname, join, resolve } from "node:path";

import { HarnessError } from "../../core/errors/index.ts";

import { isTestEnvironment, resolveCapsulesDir, resolveScratchDir } from "../../core/shared/paths.ts";

import { safeCpSync, safeRenameSync, safeRmSync } from "../../core/shared/safe-fs.ts";

import { releaseFlock, tryExclusiveFlock } from "../../platform/index.ts";

import type { CandidateRecord } from "../gates.ts";

import type { ObjectiveRecord } from "../rounds.ts";


export type ArchivedItemType = "objective" | "candidate" | "task";


export const ARCHIVED_ITEM_TYPES: readonly ArchivedItemType[] = ["objective", "candidate", "task"];


export function isArchivedItemType(value: unknown): value is ArchivedItemType {
  return typeof value === "string" && (ARCHIVED_ITEM_TYPES as readonly string[]).includes(value);
}


export interface ArchivedObjectiveRecord {
  readonly id: string;
  readonly type: ArchivedItemType;
  readonly statement: string;
  readonly generation: number;
  readonly completed_at: string;
  readonly result: string;
  readonly candidate_id?: string | null | undefined;
  readonly objective_id?: string | null | undefined;
  readonly task_id?: string | null | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly charter_goals?: readonly string[] | undefined;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}


export const BOILERPLATE_CAPSULE_SUBDIRECTORIES: readonly string[] = [
  "blobs",
  "commands",
  "evidence",
  "packets",
  "planning",
  "reports",
  "quarantine",
  "screenshots",
  "summary",
  "runtime",
];


export interface PruneBoilerplateOptions {
  readonly dryRun?: boolean | undefined;
  readonly subdirectories?: readonly string[] | undefined;
}


export interface PruneBoilerplateResult {
  readonly capsulePath: string;
  readonly prunedDirectories: readonly string[];
  readonly preservedDirectories: readonly string[];
}


export interface ArchiveCapsuleOptions {
  readonly targetArchiveDir?: string | undefined;
  readonly pruneBoilerplate?: boolean | undefined;
  readonly overwrite?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
  readonly allowGitRepositoryDeletion?: boolean | undefined;
}


export interface ArchiveCapsuleResult {
  readonly sourcePath: string;
  readonly archivedPath: string;
  readonly runId: string;
  readonly prunedDirectories: readonly string[];
}


export interface ConsolidateCapsulesOptions {
  readonly activeRunIds?: readonly string[] | undefined;
  readonly currentGeneration?: number | undefined;
  readonly retentionGenerations?: number | undefined;
  readonly targetArchiveDir?: string | undefined;
  readonly pruneBoilerplate?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}


export interface ConsolidateCapsulesResult {
  readonly capsulesDir: string;
  readonly activeCapsules: readonly string[];
  readonly archivedCapsules: readonly string[];
  readonly prunedSubdirectoriesCount: number;
  readonly archiveDir: string;
}


export interface PruneAndArchiveOptions {
  readonly sourceState: Record<string, unknown>;
  readonly sourceGeneration: number;
  readonly retentionGenerations?: number | undefined;
  readonly capsulesDir?: string | undefined;
  readonly sourceRunRoot?: string | undefined;
  readonly targetRunRoot?: string | undefined;
  readonly customArchivalPath?: string | undefined;
  readonly nowIso?: string | undefined;
  readonly consolidateCapsulesOnDisk?: boolean | undefined;
  readonly pruneBoilerplateOnDisk?: boolean | undefined;
}


export interface PruneAndArchiveResult {
  readonly archivedRecords: readonly ArchivedObjectiveRecord[];
  readonly carriedCandidates: readonly CandidateRecord[];
  readonly carriedObjectives: readonly ObjectiveRecord[];
  readonly carriedTasks: readonly Record<string, unknown>[];
  readonly prunedCount: number;
  readonly archivedCount: number;
  readonly archivalPath: string;
  readonly consolidatedCapsules?: ConsolidateCapsulesResult | undefined;
  readonly prunedBoilerplateDirectories?: readonly string[] | undefined;
}


export const DEFAULT_ARCHIVED_OBJECTIVES_FILE = ".olt/capsules/ARCHIVED_OBJECTIVES.jsonl";


type ArchivedObjectivesPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";

let archivedObjectivesPersistenceTestHook:
  | ((stage: ArchivedObjectivesPersistenceStage) => void)
  | undefined;


/** @internal deterministic persistence seam for the unit suite. */
export function __setArchivedObjectivesPersistenceTestHook(
  hook: ((stage: ArchivedObjectivesPersistenceStage) => void) | undefined,
): void {
  archivedObjectivesPersistenceTestHook = hook;
}


export function invokeArchivedObjectivesPersistenceHook(stage: ArchivedObjectivesPersistenceStage): void {
  archivedObjectivesPersistenceTestHook?.(stage);
}


export function hasOwnErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && Object.getOwnPropertyDescriptor(error, "code")?.value === code;
}


export function noFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "archived objectives ledger requires O_NOFOLLOW protection",
    );
  }
  return constants.O_NOFOLLOW;
}


/**
 * Resolves the canonical path to the archived objectives ledger.
 */
export function resolveCanonicalArchivedObjectivesPath(
  customRoot?: string,
  _useTodo = false,
): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "archived-objectives.jsonl");
}


/**
 * Resolves the path to the archived objectives ledger, supporting canonical, todo, and legacy locations.
 */
export function resolveArchivedObjectivesPath(capsulesDir?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  if (capsulesDir && capsulesDir.trim()) {
    return join(resolve(capsulesDir.trim()), "ARCHIVED_OBJECTIVES.jsonl");
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), "ARCHIVED_OBJECTIVES.jsonl");
  }
  return join(resolveCapsulesDir(), "ARCHIVED_OBJECTIVES.jsonl");
}
