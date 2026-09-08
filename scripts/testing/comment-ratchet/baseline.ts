import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { CommentBaseline, CommentBaselineEntry } from "./contracts.ts";

export const DEFAULT_COMMENT_BASELINE = "scripts/testing/comment-ratchet/baseline/index.jsonl";
export const COMMENT_BASELINE_SCHEMA = "comment-ratchet-baseline/v1";

const ENTRY_KEYS: readonly string[] = ["file", "count", "totalComments", "reason"];

export function baselineFailure(message: string): never {
  throw new Error(`Invalid comment baseline: ${message}`);
}

export function compareBaselineEntries(
  left: CommentBaselineEntry,
  right: CommentBaselineEntry,
): number {
  if (left.file < right.file) return -1;
  if (left.file > right.file) return 1;
  return 0;
}

function parseJsonLine(line: string, ordinal: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return baselineFailure(`line ${ordinal} is not valid JSON`);
  }
}

function validateEntry(value: unknown, ordinal: number): CommentBaselineEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    baselineFailure(`line ${ordinal} must be an object`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ENTRY_KEYS.includes(key)) {
      baselineFailure(`line ${ordinal} has unknown key "${key}"`);
    }
  }

  const file = record["file"];
  if (typeof file !== "string" || file.length === 0) {
    baselineFailure(`line ${ordinal} has an invalid file path`);
  }

  const count = record["count"];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    baselineFailure(`line ${ordinal} has an invalid count`);
  }

  const totalComments = record["totalComments"];
  if (
    totalComments !== undefined &&
    (typeof totalComments !== "number" || !Number.isSafeInteger(totalComments) || totalComments < 0)
  ) {
    baselineFailure(`line ${ordinal} has an invalid totalComments`);
  }

  const reason = record["reason"];
  if (reason !== undefined && (typeof reason !== "string" || reason.trim().length === 0)) {
    baselineFailure(`line ${ordinal} has an invalid reason`);
  }

  return {
    file,
    count,
    ...(totalComments !== undefined ? { totalComments } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function parseJsonFormat(parsed: Record<string, unknown>): CommentBaseline {
  if (parsed["schema"] !== COMMENT_BASELINE_SCHEMA) {
    baselineFailure("stale or missing schema");
  }
  const entriesRaw = parsed["entries"];
  if (!Array.isArray(entriesRaw)) {
    baselineFailure("entries must be an array");
  }

  const entries: CommentBaselineEntry[] = [];
  const seenFiles = new Set<string>();
  for (let index = 0; index < entriesRaw.length; index += 1) {
    const entry = validateEntry(entriesRaw[index], index + 1);
    if (seenFiles.has(entry.file)) {
      baselineFailure(`duplicate identity ${entry.file}`);
    }
    seenFiles.add(entry.file);
    entries.push(entry);
  }

  return {
    schema: COMMENT_BASELINE_SCHEMA,
    entries: entries.sort(compareBaselineEntries),
  };
}

function parseJsonlFormat(lines: readonly string[]): CommentBaseline {
  const entries: CommentBaselineEntry[] = [];
  const seenFiles = new Set<string>();
  let headerSeen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (line.length === 0) continue;
    const ordinal = index + 1;
    const parsed = parseJsonLine(line, ordinal);

    if (!headerSeen) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        baselineFailure("first line must be the schema header");
      }
      const header = parsed as Record<string, unknown>;
      if (Object.keys(header).length !== 1 || header["schema"] !== COMMENT_BASELINE_SCHEMA) {
        baselineFailure("stale or missing schema");
      }
      headerSeen = true;
      continue;
    }

    const entry = validateEntry(parsed, ordinal);
    if (seenFiles.has(entry.file)) {
      baselineFailure(`duplicate identity ${entry.file}`);
    }
    seenFiles.add(entry.file);
    entries.push(entry);
  }

  if (!headerSeen) {
    baselineFailure("stale or missing schema");
  }

  return {
    schema: COMMENT_BASELINE_SCHEMA,
    entries: entries.sort(compareBaselineEntries),
  };
}

export function parseBaseline(text: string): CommentBaseline {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    baselineFailure("empty baseline content");
  }

  if (trimmed.startsWith("{") && !trimmed.includes("\n")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null && "entries" in parsed) {
        return parseJsonFormat(parsed as Record<string, unknown>);
      }
    } catch {}
  } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null && "entries" in parsed) {
        return parseJsonFormat(parsed as Record<string, unknown>);
      }
    } catch {}
  }

  return parseJsonlFormat(text.split("\n"));
}

export function serializeBaseline(
  entries: readonly CommentBaselineEntry[],
  format: "jsonl" | "json" = "jsonl",
): string {
  const sorted = [...entries].sort(compareBaselineEntries);
  if (format === "json") {
    return JSON.stringify({ schema: COMMENT_BASELINE_SCHEMA, entries: sorted }, null, 2);
  }

  const lines = [JSON.stringify({ schema: COMMENT_BASELINE_SCHEMA })];
  for (const entry of sorted) {
    lines.push(
      JSON.stringify({
        file: entry.file,
        count: entry.count,
        ...(entry.totalComments !== undefined ? { totalComments: entry.totalComments } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function assertInsideRepository(repoRoot: string, baselinePath: string): string {
  const root = resolve(repoRoot);
  const path = resolve(root, baselinePath);
  const pathRelative = relative(root, path);
  if (pathRelative === "" || pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) {
    baselineFailure("baseline path is outside the repository");
  }
  return path;
}

export async function loadCommentBaseline(
  repoRoot: string,
  baselinePath: string,
  customReader?: ((filePath: string) => Promise<string> | string) | undefined,
): Promise<CommentBaseline> {
  const path = assertInsideRepository(repoRoot, baselinePath);
  let text: string;
  try {
    if (customReader !== undefined) {
      text = await customReader(path);
    } else {
      text = await readFile(path, "utf8");
    }
  } catch {
    baselineFailure(`missing baseline file at ${path}`);
  }
  return parseBaseline(text);
}
