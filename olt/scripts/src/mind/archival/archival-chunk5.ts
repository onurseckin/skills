import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveArchivedObjectivesPath,
  type ArchivedObjectiveRecord,
  type PruneAndArchiveOptions,
  type PruneAndArchiveResult,
} from "./archival-chunk1.ts";
import { appendArchivedObjectives, appendArchivedObjectivesCopies, isItemCompleted, extractItemGeneration } from "./archival-chunk4.ts";
import { consolidateCapsules } from "./archival-chunk7.ts";
import { pruneCapsuleBoilerplate } from "./archival-chunk6.ts";
interface CandidateRecord { [key: string]: unknown; id: string; }
interface ObjectiveRecord { [key: string]: unknown; id: string; }


/**
 * Executes generational state archival and pruning during mind:rotate.
 *
 * Rule: Completed items older than `retentionGenerations` (default: 2 generations,
 * i.e., generation <= currentGeneration - 2) are pruned from active state and archived
 * durably to ARCHIVED_OBJECTIVES.jsonl.
 *
 * Recent items (within last 2 generations: current and current - 1) and active items
 * remain in the carried active state.
 */
export function pruneAndArchiveGenerationalState(
  options: PruneAndArchiveOptions,
): PruneAndArchiveResult {
  const { sourceState, sourceGeneration } = options;
  const retention = options.retentionGenerations ?? 2;
  const cutoffGeneration = sourceGeneration - retention;
  const nowIso = options.nowIso ?? new Date().toISOString();

  const toArchive: ArchivedObjectiveRecord[] = [];
  const carriedCandidates: CandidateRecord[] = [];
  const carriedObjectives: ObjectiveRecord[] = [];
  const carriedTasks: Record<string, unknown>[] = [];

  // 1. Process Candidates
  const candidates = Array.isArray(sourceState["candidates"])
    ? (sourceState["candidates"] as Record<string, unknown>[])
    : [];

  for (const cand of candidates) {
    const candidateId = typeof cand["id"] === "string" ? cand["id"] : "cand-unknown";
    const status = typeof cand["status"] === "string" ? cand["status"] : "opened";
    const statement =
      typeof cand["statement"] === "string" ? cand["statement"] : `Candidate ${candidateId}`;
    const candGen = extractItemGeneration(cand, sourceGeneration);
    const completed = isItemCompleted(cand);

    if (completed && candGen <= cutoffGeneration) {
      // Archive and prune from active state
      const completedAt =
        typeof cand["decided_at"] === "string" && cand["decided_at"]
          ? cand["decided_at"]
          : typeof cand["completed_at"] === "string" && cand["completed_at"]
            ? cand["completed_at"]
            : nowIso;

      const result = typeof cand["result"] === "string" && cand["result"] ? cand["result"] : status;

      toArchive.push({
        id: candidateId,
        type: "candidate",
        statement,
        generation: candGen,
        completed_at: completedAt,
        result,
        candidate_id: candidateId,
        write_scope: Array.isArray(cand["write_scope"])
          ? (cand["write_scope"] as string[])
          : undefined,
        charter_goals: Array.isArray(cand["charter_goals"])
          ? (cand["charter_goals"] as string[])
          : Array.isArray(cand["charter_goal_ids"])
            ? (cand["charter_goal_ids"] as string[])
            : undefined,
        details: {
          kind: cand["kind"],
          decline_reason: cand["decline_reason"],
          gate_failed: cand["gate_failed"],
          rationale: cand["rationale"],
        },
      });
    } else {
      // Retain in active carried state (either active or recent generation)
      carriedCandidates.push(cand as unknown as CandidateRecord);
    }
  }

  // 2. Process Objectives
  const objectives = Array.isArray(sourceState["objectives"])
    ? (sourceState["objectives"] as Record<string, unknown>[])
    : [];

  for (const obj of objectives) {
    const objId = typeof obj["id"] === "string" ? obj["id"] : "obj-unknown";
    const status = typeof obj["status"] === "string" ? obj["status"] : "active";
    const statement =
      typeof obj["statement"] === "string" ? obj["statement"] : `Objective ${objId}`;
    const objGen = extractItemGeneration(obj, sourceGeneration);
    const completed = isItemCompleted(obj);

    if (completed && objGen <= cutoffGeneration) {
      // Archive and prune
      const completedAt =
        typeof obj["updated_at"] === "string" && obj["updated_at"]
          ? obj["updated_at"]
          : typeof obj["completed_at"] === "string" && obj["completed_at"]
            ? obj["completed_at"]
            : nowIso;

      toArchive.push({
        id: objId,
        type: "objective",
        statement,
        generation: objGen,
        completed_at: completedAt,
        result: status,
        objective_id: objId,
        candidate_id: typeof obj["candidate_id"] === "string" ? obj["candidate_id"] : undefined,
        details: {
          current_round: obj["current_round"],
          max_rounds: obj["max_rounds"],
          rounds_count: Array.isArray(obj["rounds"]) ? obj["rounds"].length : 0,
        },
      });
    } else {
      carriedObjectives.push(obj as unknown as ObjectiveRecord);
    }
  }

  // 3. Process Tasks
  const rawTasks = sourceState["tasks"];
  const taskList: Record<string, unknown>[] = [];
  if (Array.isArray(rawTasks)) {
    for (const t of rawTasks) {
      if (typeof t === "object" && t !== null) taskList.push(t as Record<string, unknown>);
    }
  } else if (typeof rawTasks === "object" && rawTasks !== null) {
    for (const t of Object.values(rawTasks as Record<string, unknown>)) {
      if (typeof t === "object" && t !== null) taskList.push(t as Record<string, unknown>);
    }
  }

  for (const task of taskList) {
    const taskId = typeof task["id"] === "string" ? task["id"] : "task-unknown";
    const status = typeof task["status"] === "string" ? task["status"] : "unknown";
    const label = typeof task["label"] === "string" ? task["label"] : taskId;
    const taskGen = extractItemGeneration(task, sourceGeneration);
    const completed = isItemCompleted(task);

    if (completed && taskGen <= cutoffGeneration) {
      const completedAt =
        typeof task["completed_at"] === "string" && task["completed_at"]
          ? task["completed_at"]
          : nowIso;

      toArchive.push({
        id: taskId,
        type: "task",
        statement: label,
        generation: taskGen,
        completed_at: completedAt,
        result: status,
        task_id: taskId,
        write_scope: Array.isArray(task["write_scope"])
          ? (task["write_scope"] as string[])
          : undefined,
        details: {
          role: task["role"],
          status,
        },
      });
    } else {
      carriedTasks.push(task);
    }
  }

  // 4. Durable write to ARCHIVED_OBJECTIVES.jsonl
  const archivalPath = resolveArchivedObjectivesPath(
    options.capsulesDir,
    options.customArchivalPath,
  );

  if (toArchive.length > 0) {
    const requiredArchiveCopies = [archivalPath];
    // Also persist inside source capsule directory if available. Both copies are mandatory
    // once selected; appendArchivedObjectivesCopies intentionally propagates any failure.
    if (options.sourceRunRoot && existsSync(options.sourceRunRoot)) {
      requiredArchiveCopies.push(join(options.sourceRunRoot, "ARCHIVED_OBJECTIVES.jsonl"));
    }
    appendArchivedObjectivesCopies(toArchive, requiredArchiveCopies);
  }

  // 5. Prune boilerplate subdirectories & consolidate legacy capsule roots if requested
  const prunedBoilerplateDirs: string[] = [];
  if (options.pruneBoilerplateOnDisk !== false) {
    if (options.sourceRunRoot && existsSync(options.sourceRunRoot)) {
      const pruneRes = pruneCapsuleBoilerplate(options.sourceRunRoot);
      prunedBoilerplateDirs.push(...pruneRes.prunedDirectories);
    }
    if (options.targetRunRoot && existsSync(options.targetRunRoot)) {
      const pruneRes = pruneCapsuleBoilerplate(options.targetRunRoot);
      prunedBoilerplateDirs.push(...pruneRes.prunedDirectories);
    }
  }

  let consolidatedCapsules: ConsolidateCapsulesResult | undefined;
  if (options.consolidateCapsulesOnDisk && options.capsulesDir && existsSync(options.capsulesDir)) {
    consolidatedCapsules = consolidateCapsules(options.capsulesDir, {
      currentGeneration: sourceGeneration,
      retentionGenerations: retention,
      pruneBoilerplate: options.pruneBoilerplateOnDisk !== false,
    });
  }

  return {
    archivedRecords: toArchive,
    carriedCandidates,
    carriedObjectives,
    carriedTasks,
    prunedCount: toArchive.length,
    archivedCount: toArchive.length,
    archivalPath,
    ...(consolidatedCapsules !== undefined ? { consolidatedCapsules } : {}),
    ...(prunedBoilerplateDirs.length > 0
      ? { prunedBoilerplateDirectories: prunedBoilerplateDirs }
      : {}),
  };
}


/**
 * Checks whether a directory is empty or contains only ignorable OS files / empty subdirectories.
 */
export function isEffectivelyEmptyDirectory(dirPath: string): boolean {
  if (!existsSync(dirPath)) return true;
  try {
    const stat = lstatSync(dirPath);
    if (!stat.isDirectory()) return false;
    const entries = readdirSync(dirPath);
    if (entries.length === 0) return true;

    for (const entry of entries) {
      if (entry === ".DS_Store") continue;
      const childPath = join(dirPath, entry);
      try {
        const childStat = lstatSync(childPath);
        if (!childStat.isDirectory()) return false;
        if (!isEffectivelyEmptyDirectory(childPath)) return false;
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
