import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteBytes } from "../../../core/durable-write.ts";
import type { ViewStorage } from "../layout/blobs.ts";

export const CAPTURES_FILE = "captures.json";
export const CAPTURES_SCHEMA = "harness.captures";

export type CaptureKind = "screenshot" | "visual_report";

export interface CaptureRecord {
  kind: CaptureKind;
  name: string;
  sha256: string;
  bytes: number;
  blob_path: string;
  path: string;
  storage: ViewStorage;
  original_path: string;
  command_id?: string | undefined;
  task_id?: string | undefined;
  actor?: string | undefined;
  timestamp?: string | undefined;
}

export interface CaptureLedger {
  schema: typeof CAPTURES_SCHEMA;
  version: number;
  captures: CaptureRecord[];
  updated_at: string;
}

export function capturesPath(runRoot: string): string {
  return join(runRoot, CAPTURES_FILE);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedCapture(value: unknown): CaptureRecord | undefined {
  if (!isObject(value)) return undefined;
  const {
    kind,
    name,
    sha256,
    path,
    bytes,
    blob_path,
    storage,
    original_path,
    command_id,
    task_id,
    actor,
    timestamp,
  } = value;
  if (kind !== "screenshot" && kind !== "visual_report") return undefined;
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (typeof sha256 !== "string" || sha256.length !== 64) return undefined;
  if (typeof path !== "string" || path.length === 0) return undefined;
  if (typeof storage !== "string" || storage.length === 0) return undefined;
  return {
    kind,
    name,
    sha256,
    bytes: typeof bytes === "number" ? bytes : 0,
    blob_path: typeof blob_path === "string" ? blob_path : "",
    path,
    storage: storage as "hardlink" | "copy",
    original_path: typeof original_path === "string" ? original_path : "",
    ...(typeof command_id === "string" ? { command_id } : {}),
    ...(typeof task_id === "string" ? { task_id } : {}),
    ...(typeof actor === "string" ? { actor } : {}),
    ...(typeof timestamp === "string" ? { timestamp } : {}),
  };
}

export function readCaptures(runRoot: string): CaptureRecord[] {
  const path = capturesPath(runRoot);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!isObject(parsed) || !Array.isArray(parsed.captures)) return [];
    return parsed.captures
      .map(storedCapture)
      .filter((record): record is CaptureRecord => record !== undefined);
  } catch {
    return [];
  }
}

export function recordCaptures(runRoot: string, additions: readonly CaptureRecord[]): boolean {
  if (additions.length === 0) return false;
  const existing = readCaptures(runRoot);
  const seen = new Set(existing.map((record) => `${record.kind}:${record.sha256}`));
  const merged = [...existing];
  for (const addition of additions) {
    const key = `${addition.kind}:${addition.sha256}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(addition);
  }
  if (merged.length === existing.length) return false;
  const ledger: CaptureLedger = {
    schema: CAPTURES_SCHEMA,
    version: 1,
    captures: merged,
    updated_at: new Date().toISOString(),
  };
  atomicWriteBytes(
    capturesPath(runRoot),
    new TextEncoder().encode(`${JSON.stringify(ledger, null, 2)}\n`),
  );
  return true;
}
