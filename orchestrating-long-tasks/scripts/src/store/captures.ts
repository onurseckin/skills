import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteBytes } from "../core/durable-write.ts";
import type { ViewStorage } from "./blobs.ts";

export const CAPTURES_FILE = "captures.json";
export const CAPTURES_SCHEMA = "harness.captures";

export type CaptureKind = "screenshot" | "visual_report";

/**
 * One capture, recorded once. The bytes live in `blobs/<aa>/<sha256>` and nowhere else; this record
 * says what they are, what they are called, and who produced them.
 *
 * Ownership is what the ingestion observed, never what a filename resembles. A capture with no
 * `command_id` and no `task_id` belongs to no node, and stays unattributed rather than being guessed
 * onto the nearest one.
 */
export interface CaptureRecord {
  kind: CaptureKind;
  /** Readable file name inside the view directory. */
  name: string;
  sha256: string;
  bytes: number;
  /** Capsule-relative path of the blob: the physical home. */
  blob_path: string;
  /** Capsule-relative path of the readable name that links to the blob. */
  path: string;
  storage: ViewStorage;
  /** Where the file was found. Outside the capsule by definition, so it stays absolute. */
  original_path: string;
  command_id?: string | undefined;
  task_id?: string | undefined;
  actor?: string | undefined;
  /** When the capture happened, as the file's own mtime reports it. Absent when unreadable. */
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

/** A stored entry only counts once it names both its content and the file that shows it. */
function storedCapture(value: unknown): CaptureRecord | undefined {
  if (!isObject(value)) return undefined;
  const { kind, name, sha256, path } = value;
  if (kind !== "screenshot" && kind !== "visual_report") return undefined;
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (typeof sha256 !== "string" || sha256.length !== 64) return undefined;
  if (typeof path !== "string" || path.length === 0) return undefined;
  return value as unknown as CaptureRecord;
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

/**
 * Records captures that were not already recorded, keyed by content. A second sighting of the same
 * bytes is the same capture, so it does not become a second record under a second owner — that
 * re-attribution is exactly how one stale image ended up claimed by every command in a run.
 *
 * Reports whether the ledger changed, so a caller that keeps a catalogue over it knows when the
 * catalogue has fallen behind.
 */
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
  // Indented rather than canonical: this file is one a person opens to see what a run captured.
  atomicWriteBytes(capturesPath(runRoot), Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`));
  return true;
}
