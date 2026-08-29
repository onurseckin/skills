import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, RunState } from "../../../core/contracts/index.ts";
import { atomicWriteBytes } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { listBlobs } from "../layout/blobs.ts";
import { readCaptures } from "./captures.ts";
import { runFilePath } from "./paths.ts";
import {
  INDEX_FILE,
  INDEX_SCHEMA,
  type CapsuleIndex,
  type IndexTask,
  type IndexCommand,
  type IndexFinding,
  type IndexReport,
  type IndexCapture,
  type IndexBlob,
  type IndexPacket,
  type IndexFreshness,
  type LoadedIndex,
  indexTasks,
  indexCommands,
  indexPackets,
  indexReports,
  captureLedgerDigest,
  optional,
} from "./capsule-index-types.ts";

export {
  INDEX_FILE,
  INDEX_SCHEMA,
  type CapsuleIndex,
  type IndexTask,
  type IndexCommand,
  type IndexFinding,
  type IndexReport,
  type IndexCapture,
  type IndexBlob,
  type IndexPacket,
  type IndexFreshness,
  type LoadedIndex,
};

export function buildIndex(runRoot: string, state: RunState, runId: string): CapsuleIndex {
  const { tasks, findings } = indexTasks(state);
  const captures = readCaptures(runRoot);
  const referenceCount = new Map<string, number>();
  for (const capture of captures)
    referenceCount.set(capture.sha256, (referenceCount.get(capture.sha256) ?? 0) + 1);
  return {
    schema: INDEX_SCHEMA,
    version: 1,
    derived: true,
    run_id: runId,
    generated_at: new Date().toISOString(),
    index_of_event: { sequence: state.event_sequence, head: state.event_head },
    index_of_captures: captureLedgerDigest(runRoot),
    tasks,
    commands: indexCommands(state),
    findings,
    reports: indexReports(
      runRoot,
      tasks.map((task) => task.id),
    ),
    captures: captures.map((capture) => ({
      kind: capture.kind,
      name: capture.name,
      sha256: capture.sha256,
      path: capture.path,
      bytes: capture.bytes,
      ...optional("task_id", capture.task_id),
      ...optional("command_id", capture.command_id),
    })),
    blobs: listBlobs(runRoot).map((blob) => ({
      sha256: blob.sha256,
      bytes: blob.bytes,
      path: blob.path,
      references: referenceCount.get(blob.sha256) ?? 0,
    })),
    packets: indexPackets(state),
  };
}

function manifestRunId(runRoot: string): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(runFilePath(runRoot, "manifest.json"), "utf-8"),
    );
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>).run_id;
      if (typeof value === "string") return value;
    }
  } catch {}
  return "unknown";
}

export function writeIndex(runRoot: string, state: RunState, runId?: string): CapsuleIndex {
  const index = buildIndex(runRoot, state, runId ?? manifestRunId(runRoot));
  atomicWriteBytes(
    join(runRoot, INDEX_FILE),
    new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`),
  );
  return index;
}

function parsedIndex(value: unknown): CapsuleIndex | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== INDEX_SCHEMA) return undefined;
  const head = candidate.index_of_event;
  if (typeof head !== "object" || head === null || Array.isArray(head)) return undefined;
  return candidate as unknown as CapsuleIndex;
}

export function loadIndex(runRoot: string): LoadedIndex {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(runFilePath(runRoot, "manifest.json"), "utf-8")) as Manifest;
  } catch (error) {
    throw new HarnessError("INTEGRITY", `manifest.json is unreadable: ${String(error)}`);
  }
  let index: CapsuleIndex | undefined;
  try {
    index = parsedIndex(JSON.parse(readFileSync(join(runRoot, INDEX_FILE), "utf-8")));
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${INDEX_FILE} is unreadable: ${String(error)}`);
  }
  if (index === undefined)
    throw new HarnessError("INTEGRITY", `${INDEX_FILE} is not a capsule index`);
  return { runRoot, manifest, index };
}

export function indexFreshness(runRoot: string, index: CapsuleIndex): IndexFreshness {
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(runFilePath(runRoot, "state.json"), "utf-8"));
  } catch {
    return "unknown";
  }
  if (typeof state !== "object" || state === null || Array.isArray(state)) return "unknown";
  const projection = state as Record<string, unknown>;
  const sequence = projection.event_sequence;
  const head = projection.event_head;
  if (typeof sequence !== "number" || (head !== null && typeof head !== "string")) return "unknown";
  if (index.index_of_event.sequence !== sequence || index.index_of_event.head !== head)
    return "stale";
  return index.index_of_captures === captureLedgerDigest(runRoot) ? "current" : "stale";
}

export function refreshIndex(runRoot: string): void {
  let state: RunState;
  try {
    state = JSON.parse(readFileSync(runFilePath(runRoot, "state.json"), "utf-8")) as RunState;
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `refreshIndex could not read state.json at ${runRoot}: ${String(error)}`,
    );
  }
  writeIndex(runRoot, state);
}
