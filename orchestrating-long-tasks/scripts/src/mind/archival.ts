import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";
import type { CandidateRecord } from "./gates.ts";
import type { ObjectiveRecord } from "./rounds.ts";

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

export interface PruneAndArchiveOptions {
  readonly sourceState: Record<string, unknown>;
  readonly sourceGeneration: number;
  readonly retentionGenerations?: number | undefined;
  readonly capsulesDir?: string | undefined;
  readonly sourceRunRoot?: string | undefined;
  readonly targetRunRoot?: string | undefined;
  readonly customArchivalPath?: string | undefined;
  readonly nowIso?: string | undefined;
}

export interface PruneAndArchiveResult {
  readonly archivedRecords: readonly ArchivedObjectiveRecord[];
  readonly carriedCandidates: readonly CandidateRecord[];
  readonly carriedObjectives: readonly ObjectiveRecord[];
  readonly carriedTasks: readonly Record<string, unknown>[];
  readonly prunedCount: number;
  readonly archivedCount: number;
  readonly archivalPath: string;
}

const DEFAULT_ARCHIVED_OBJECTIVES_FILE = ".capsules/ARCHIVED_OBJECTIVES.jsonl";

/**
 * Resolves the path to the ARCHIVED_OBJECTIVES.jsonl ledger.
 */
export function resolveArchivedObjectivesPath(
  capsulesDir?: string,
  customPath?: string,
): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  if (capsulesDir && capsulesDir.trim()) {
    return join(resolve(capsulesDir.trim()), "ARCHIVED_OBJECTIVES.jsonl");
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".capsules"))) {
    return join(cwd, DEFAULT_ARCHIVED_OBJECTIVES_FILE);
  }
  const parentCapsules = join(dirname(cwd), ".capsules");
  if (existsSync(parentCapsules)) {
    return join(dirname(cwd), DEFAULT_ARCHIVED_OBJECTIVES_FILE);
  }
  return resolve(cwd, DEFAULT_ARCHIVED_OBJECTIVES_FILE);
}

/**
 * Validates and normalizes an unknown object into an ArchivedObjectiveRecord.
 */
export function validateArchivedObjectiveRecord(raw: unknown): ArchivedObjectiveRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord must be an object");
  }

  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"].trim() : "";
  if (!id) {
    throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord requires non-empty id");
  }

  const rawType = r["type"];
  const type: ArchivedItemType = isArchivedItemType(rawType) ? rawType : "objective";

  const statement =
    typeof r["statement"] === "string" && r["statement"].trim()
      ? r["statement"].trim()
      : typeof r["title"] === "string" && r["title"].trim()
        ? r["title"].trim()
        : `Item ${id}`;

  const generation =
    typeof r["generation"] === "number" && Number.isFinite(r["generation"])
      ? r["generation"]
      : typeof r["generation_id"] === "number" && Number.isFinite(r["generation_id"])
        ? (r["generation_id"] as number)
        : 1;

  const completedAt =
    typeof r["completed_at"] === "string" && r["completed_at"].trim()
      ? r["completed_at"].trim()
      : typeof r["closed_at"] === "string" && r["closed_at"].trim()
        ? r["closed_at"].trim()
        : typeof r["decided_at"] === "string" && r["decided_at"].trim()
          ? r["decided_at"].trim()
          : new Date().toISOString();

  const result =
    typeof r["result"] === "string" && r["result"].trim()
      ? r["result"].trim()
      : typeof r["status"] === "string" && r["status"].trim()
        ? r["status"].trim()
        : "completed";

  const candidateId =
    typeof r["candidate_id"] === "string"
      ? r["candidate_id"].trim()
      : r["candidate_id"] === null
        ? null
        : undefined;

  const objectiveId =
    typeof r["objective_id"] === "string"
      ? r["objective_id"].trim()
      : r["objective_id"] === null
        ? null
        : undefined;

  const taskId =
    typeof r["task_id"] === "string"
      ? r["task_id"].trim()
      : r["task_id"] === null
        ? null
        : undefined;

  const writeScope = Array.isArray(r["write_scope"])
    ? (r["write_scope"] as readonly string[])
    : undefined;

  const charterGoals = Array.isArray(r["charter_goals"])
    ? (r["charter_goals"] as readonly string[])
    : Array.isArray(r["charter_goal_ids"])
      ? (r["charter_goal_ids"] as readonly string[])
      : undefined;

  const details =
    typeof r["details"] === "object" && r["details"] !== null && !Array.isArray(r["details"])
      ? (r["details"] as Readonly<Record<string, unknown>>)
      : undefined;

  const metadata =
    typeof r["metadata"] === "object" && r["metadata"] !== null && !Array.isArray(r["metadata"])
      ? (r["metadata"] as Readonly<Record<string, unknown>>)
      : undefined;

  return {
    id,
    type,
    statement,
    generation,
    completed_at: completedAt,
    result,
    ...(candidateId !== undefined ? { candidate_id: candidateId } : {}),
    ...(objectiveId !== undefined ? { objective_id: objectiveId } : {}),
    ...(taskId !== undefined ? { task_id: taskId } : {}),
    ...(writeScope !== undefined ? { write_scope: writeScope } : {}),
    ...(charterGoals !== undefined ? { charter_goals: charterGoals } : {}),
    ...(details !== undefined ? { details } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Reads and parses all records from ARCHIVED_OBJECTIVES.jsonl.
 */
export function readArchivedObjectives(customPath?: string): ArchivedObjectiveRecord[] {
  const filePath = resolveArchivedObjectivesPath(undefined, customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const items: ArchivedObjectiveRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const validated = validateArchivedObjectiveRecord(parsed);
      items.push(validated);
    } catch {
      // Skip malformed individual line in log
    }
  }

  return items;
}

/**
 * Writes records atomically to ARCHIVED_OBJECTIVES.jsonl.
 */
export function writeArchivedObjectives(
  items: readonly ArchivedObjectiveRecord[],
  customPath?: string,
): void {
  const filePath = resolveArchivedObjectivesPath(undefined, customPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = items.map((item) => JSON.stringify(item));
  writeFileSync(filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
}

/**
 * Appends or updates archived objective records in ARCHIVED_OBJECTIVES.jsonl.
 */
export function appendArchivedObjectives(
  records: readonly ArchivedObjectiveRecord[],
  customPath?: string,
): ArchivedObjectiveRecord[] {
  if (records.length === 0) {
    return readArchivedObjectives(customPath);
  }

  const existing = readArchivedObjectives(customPath);
  const recordMap = new Map<string, ArchivedObjectiveRecord>();

  for (const item of existing) {
    recordMap.set(item.id, item);
  }

  for (const r of records) {
    const validated = validateArchivedObjectiveRecord(r);
    recordMap.set(validated.id, validated);
  }

  const merged = Array.from(recordMap.values());
  writeArchivedObjectives(merged, customPath);
  return merged;
}

/**
 * Determines whether a candidate, objective, or task is completed or closed.
 */
export function isItemCompleted(item: Record<string, unknown>): boolean {
  const status = typeof item["status"] === "string" ? item["status"].trim().toLowerCase() : "";
  const result = typeof item["result"] === "string" ? item["result"].trim().toLowerCase() : "";

  if (
    status === "completed" ||
    status === "converged" ||
    status === "resolved" ||
    status === "exhausted" ||
    status === "escalated" ||
    status === "closed" ||
    status === "declined"
  ) {
    return true;
  }

  if (
    result === "converged" ||
    result === "exhausted" ||
    result === "escalated" ||
    result === "completed" ||
    result === "resolved"
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts generation number from an item, using fallback if not explicitly provided.
 */
export function extractItemGeneration(
  item: Record<string, unknown>,
  fallbackGeneration: number,
): number {
  if (typeof item["generation"] === "number" && Number.isFinite(item["generation"])) {
    return item["generation"];
  }

  if (typeof item["generation_id"] === "string") {
    const match = item["generation_id"].match(/(?:gen|generation)[-_]?(\d+)/i);
    if (match && match[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  if (typeof item["generation_id"] === "number" && Number.isFinite(item["generation_id"])) {
    return item["generation_id"];
  }

  return fallbackGeneration;
}

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
    const statement = typeof cand["statement"] === "string" ? cand["statement"] : `Candidate ${candidateId}`;
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

      const result =
        typeof cand["result"] === "string" && cand["result"]
          ? cand["result"]
          : status;

      toArchive.push({
        id: candidateId,
        type: "candidate",
        statement,
        generation: candGen,
        completed_at: completedAt,
        result,
        candidate_id: candidateId,
        write_scope: Array.isArray(cand["write_scope"]) ? (cand["write_scope"] as string[]) : undefined,
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
    const statement = typeof obj["statement"] === "string" ? obj["statement"] : `Objective ${objId}`;
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
        write_scope: Array.isArray(task["write_scope"]) ? (task["write_scope"] as string[]) : undefined,
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
    appendArchivedObjectives(toArchive, archivalPath);

    // Also persist inside source capsule directory if available
    if (options.sourceRunRoot && existsSync(options.sourceRunRoot)) {
      const sourceCapsuleArchivalPath = join(options.sourceRunRoot, "ARCHIVED_OBJECTIVES.jsonl");
      appendArchivedObjectives(toArchive, sourceCapsuleArchivalPath);
    }
  }

  return {
    archivedRecords: toArchive,
    carriedCandidates,
    carriedObjectives,
    carriedTasks,
    prunedCount: toArchive.length,
    archivedCount: toArchive.length,
    archivalPath,
  };
}
