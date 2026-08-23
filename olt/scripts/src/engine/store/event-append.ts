import { closeSync, constants, fsyncSync, lstatSync, openSync, writeSync } from "node:fs";
import type { HarnessEvent, Manifest, RunState } from "../../core/contracts/capsule.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { canonicalJsonBytes, normalizeJson, sha256Bytes } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { writeIndex } from "./capsule-index.ts";
import {
  EVENT_SCHEMA,
  FORMAT_VERSION,
  isCheckpointSequence,
  type StoreLimits,
} from "./constants.ts";
import { runFilePath } from "./paths.ts";
import { diffProjection } from "./projection-patch.ts";
import { businessFields, cloneObject, isTerminalState } from "./state.ts";
import { appendTraceStep } from "./trace.ts";

function append(path: string, data: Uint8Array): void {
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    let offset = 0;
    while (offset < data.byteLength)
      offset += writeSync(descriptor, data, offset, data.byteLength - offset);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function appendProjectionEvent(
  runRoot: string,
  manifest: Manifest,
  current: RunState,
  actor: string,
  kind: string,
  payload: JsonObject,
  draft: RunState,
  configured: Required<StoreLimits>,
): RunState {
  const sequence = current.event_sequence + 1;
  if (sequence > configured.maxEventCount)
    throw new HarnessError("INVALID_STATE", "event count exceeds configured limit");
  draft.event_sequence = sequence;
  draft.revision = current.revision + 1;
  delete (draft as Partial<RunState>).event_head;
  const normalized = normalizeJson(draft, "mutated state");
  if (typeof normalized !== "object" || normalized === null || Array.isArray(normalized))
    throw new HarnessError("INVALID_STATE", "mutated state must be an object");
  const projection = normalized as RunState;
  if (canonicalJsonBytes(projection).byteLength > configured.maxJsonBytes)
    throw new HarnessError("INVALID_STATE", "state exceeds size limit");
  const checkpoint = isCheckpointSequence(sequence) || isTerminalState(projection);
  const content: JsonObject = {
    schema: EVENT_SCHEMA,
    version: FORMAT_VERSION,
    run_id: manifest.run_id,
    capsule_id: manifest.capsule_id,
    sequence,
    revision: projection.revision,
    timestamp: new Date().toISOString(),
    actor,
    kind,
    payload,
    previous_hash: current.event_head,
    projection: checkpoint ? projection : null,
    projection_patch: checkpoint
      ? null
      : diffProjection(businessFields(current), businessFields(projection)),
  };
  const event = {
    ...content,
    hash: sha256Bytes(canonicalJsonBytes(content)),
  } as unknown as HarnessEvent;
  const encoded = canonicalJsonBytes(event);
  if (encoded.byteLength > configured.maxEventBytes)
    throw new HarnessError("INVALID_STATE", "event exceeds size limit");
  const line = new Uint8Array(encoded.byteLength + 1);
  line.set(encoded);
  line[line.length - 1] = 10;
  const eventPath = runFilePath(runRoot, "events.jsonl");
  if (lstatSync(eventPath).size + line.byteLength > configured.maxEventLogBytes)
    throw new HarnessError("INVALID_STATE", "event log size exceeds configured limit");
  append(eventPath, line);
  const next = { ...projection, event_head: event.hash };
  atomicWriteJson(runFilePath(runRoot, "state.json"), next);
  refreshDerived(runRoot, manifest, event, next);
  return cloneObject(next);
}

function refreshDerived(
  runRoot: string,
  manifest: Manifest,
  event: HarnessEvent,
  next: RunState,
): void {
  try {
    appendTraceStep(runRoot, event);
  } catch {}
  try {
    writeIndex(runRoot, next, manifest.run_id);
  } catch {}
}
