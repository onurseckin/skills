import { tryExclusiveFlock } from "../../platform/index.ts";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { HarnessError } from "../../core/errors/index.ts";
import {
  hasOwnErrorCode,
  noFollowFlag,
  isArchivedItemType,
  resolveArchivedObjectivesPath,
  type ArchivedItemType,
  type ArchivedObjectiveRecord,
} from "./archival-chunk1.ts";


/**
 * Migrates legacy archived objectives files to the canonical .capsules/mind/queue/ layout.
 */

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

  const valueString = (key: string): string | undefined =>
    typeof r[key] === "string" && r[key].trim() ? r[key].trim() : undefined;
  const isLegacyV1 = r["schema_version"] === 1;
  let type: ArchivedItemType;
  let statement: string;
  let generation: number;
  let completedAt: string;
  let result: string;

  if (isLegacyV1) {
    const legacyType = r["type"];
    type = isArchivedItemType(legacyType) ? legacyType : "objective";
    statement = valueString("title") ?? valueString("statement") ?? "";
    generation =
      typeof r["generation_id"] === "number" && Number.isFinite(r["generation_id"])
        ? (r["generation_id"] as number)
        : typeof r["generation"] === "number" && Number.isFinite(r["generation"])
          ? (r["generation"] as number)
          : Number.NaN;
    completedAt =
      valueString("closed_at") ?? valueString("decided_at") ?? valueString("completed_at") ?? "";
    result = valueString("status") ?? valueString("result") ?? "";
  } else {
    if (r["schema_version"] !== undefined && r["schema_version"] !== 2) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "ArchivedObjectiveRecord has unsupported schema_version",
      );
    }
    if (!isArchivedItemType(r["type"])) {
      throw new HarnessError("INVALID_ARGUMENT", "ArchivedObjectiveRecord requires a valid type");
    }
    type = r["type"];
    statement = valueString("statement") ?? "";
    generation =
      typeof r["generation"] === "number" && Number.isFinite(r["generation"])
        ? (r["generation"] as number)
        : Number.NaN;
    completedAt = valueString("completed_at") ?? "";
    result = valueString("result") ?? "";
  }
  if (!statement || !Number.isFinite(generation) || !completedAt || !result) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      isLegacyV1
        ? "legacy ArchivedObjectiveRecord v1 is missing a required explicit legacy field"
        : "ArchivedObjectiveRecord is missing a required current field",
    );
  }

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
    : isLegacyV1 && Array.isArray(r["charter_goal_ids"])
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
  return parseArchivedObjectives(readArchivedObjectivesFile(filePath).raw);
}


interface ArchivedObjectivesSnapshot {
  readonly raw: string;
  readonly identity?: { readonly dev: number; readonly ino: number } | undefined;
}


export function readArchivedObjectivesFile(filePath: string): ArchivedObjectivesSnapshot {
  let descriptor: number | undefined;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      throw new HarnessError(
        "INTEGRITY",
        "archived objectives ledger must be a single-link regular file",
      );
    }
    descriptor = openSync(filePath, constants.O_RDONLY | noFollowFlag());
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new HarnessError("INTEGRITY", "archived objectives ledger changed while being opened");
    }
    const raw = readFileSync(descriptor, "utf8");
    const after = lstatSync(filePath);
    if (
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      throw new HarnessError("INTEGRITY", "archived objectives ledger changed while being read");
    }
    return { raw, identity: { dev: opened.dev, ino: opened.ino } };
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) return { raw: "" };
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(
      "INTEGRITY",
      `could not securely read archived objectives ledger: ${filePath}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}


export function parseArchivedObjectives(raw: string): ArchivedObjectiveRecord[] {
  const items: ArchivedObjectiveRecord[] = [];
  const ids = new Set<string>();

  for (const [index, line] of raw.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      const validated = validateArchivedObjectiveRecord(parsed);
      if (ids.has(validated.id)) {
        throw new HarnessError(
          "INTEGRITY",
          `archived objectives ledger line ${index + 1} duplicates id '${validated.id}'`,
        );
      }
      ids.add(validated.id);
      items.push(validated);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError(
        "INTEGRITY",
        `archived objectives ledger line ${index + 1} is malformed`,
      );
    }
  }

  return items;
}


export function assertUniqueArchivedObjectives(
  items: readonly ArchivedObjectiveRecord[],
): ArchivedObjectiveRecord[] {
  const canonical: ArchivedObjectiveRecord[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    const validated = validateArchivedObjectiveRecord(item);
    if (ids.has(validated.id)) {
      throw new HarnessError(
        "INTEGRITY",
        `archived objectives ledger duplicates id '${validated.id}'`,
      );
    }
    ids.add(validated.id);
    canonical.push(validated);
  }
  return canonical;
}


export function acquireArchivedObjectivesFlock(descriptor: number, label: string): void {
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 200; attempt++) {
    if (tryExclusiveFlock(descriptor)) return;
    Atomics.wait(sleep, 0, 0, 5);
  }
  throw new HarnessError("LOCK_TIMEOUT", `${label} is already locked`);
}
