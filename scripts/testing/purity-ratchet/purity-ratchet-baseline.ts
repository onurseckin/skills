import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { PurityBaseline, PurityBaselineEntry } from "./purity-ratchet-contracts.ts";

export const PURITY_BASELINE_SCHEMA = "olt-purity-baseline/v1";

const ENTRY_KEYS = ["file", "rule", "count"];

function failure(message: string): never {
  throw new Error(`Invalid purity baseline: ${message}`);
}

export function assertInsideRepository(repoRoot: string, baselinePath: string): string {
  const root = resolve(repoRoot);
  const path = resolve(root, baselinePath);
  const pathRelative = relative(root, path);
  if (pathRelative === "") {
    failure("baseline path is outside the repository");
  }
  if (pathRelative === "..") {
    failure("baseline path is outside the repository");
  }
  if (pathRelative.startsWith(`..${sep}`)) {
    failure("baseline path is outside the repository");
  }
  return path;
}

export function entryIdentity(entry: { readonly file: string; readonly rule: string }): string {
  return `${entry.file} ${entry.rule}`;
}

function parseLine(line: string, ordinal: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return failure(`line ${ordinal} is not valid JSON`);
  }
}

function validateEntry(value: unknown, ordinal: number): PurityBaselineEntry {
  if (typeof value !== "object") failure(`line ${ordinal} must be an object`);
  if (value === null) failure(`line ${ordinal} must be an object`);
  if (Array.isArray(value)) failure(`line ${ordinal} must be an object`);
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ENTRY_KEYS.includes(key))) {
    failure(`line ${ordinal} has unknown keys`);
  }
  const file = record["file"];
  if (typeof file !== "string" || file.length === 0) {
    failure(`line ${ordinal} has an invalid file`);
  }
  const rule = record["rule"];
  if (typeof rule !== "string" || rule.length === 0) {
    failure(`line ${ordinal} has an invalid rule`);
  }
  const count = record["count"];
  if (typeof count !== "number") failure(`line ${ordinal} has an invalid count`);
  if (!Number.isSafeInteger(count)) failure(`line ${ordinal} has an invalid count`);
  if (count < 1) failure(`line ${ordinal} has an invalid count`);
  return { file, rule, count };
}

export function compareEntries(left: PurityBaselineEntry, right: PurityBaselineEntry): number {
  if (left.file < right.file) return -1;
  if (left.file > right.file) return 1;
  if (left.rule < right.rule) return -1;
  if (left.rule > right.rule) return 1;
  return 0;
}

export function parseBaseline(text: string): PurityBaseline {
  const lines = text.split("\n");
  const entries: PurityBaselineEntry[] = [];
  const identities = new Set<string>();
  let headerSeen = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (line.length === 0) continue;
    const ordinal = index + 1;
    const parsed = parseLine(line, ordinal);
    if (!headerSeen) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        failure("first line must be the schema header");
      }
      const header = parsed as Record<string, unknown>;
      if (Object.keys(header).length !== 1) failure("first line must be the schema header");
      if (header["schema"] !== PURITY_BASELINE_SCHEMA) failure("stale or missing schema");
      headerSeen = true;
      continue;
    }
    const entry = validateEntry(parsed, ordinal);
    const identity = entryIdentity(entry);
    if (identities.has(identity)) failure(`duplicate identity ${entry.file}:${entry.rule}`);
    identities.add(identity);
    entries.push(entry);
  }
  if (!headerSeen) failure("stale or missing schema");
  return { schema: PURITY_BASELINE_SCHEMA, entries };
}

export function serializeBaseline(entries: readonly PurityBaselineEntry[]): string {
  const sorted = [...entries].sort(compareEntries);
  const lines = [JSON.stringify({ schema: PURITY_BASELINE_SCHEMA })];
  for (const entry of sorted) {
    lines.push(JSON.stringify({ file: entry.file, rule: entry.rule, count: entry.count }));
  }
  return `${lines.join("\n")}\n`;
}

export async function loadPurityBaseline(
  repoRoot: string,
  baselinePath: string,
): Promise<PurityBaseline> {
  const path = assertInsideRepository(repoRoot, baselinePath);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    failure("missing baseline file");
  }
  return parseBaseline(text);
}
