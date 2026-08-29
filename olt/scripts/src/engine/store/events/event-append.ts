import { existsSync, lstatSync, unlinkSync } from "node:fs";
import type { HarnessEvent, Manifest, RunState } from "../../../core/contracts/index.ts";
import type { JsonObject } from "../../../core/contracts/index.ts";
import {
  atomicWriteJson,
  durableAppendBytes,
  fsyncDirectory,
} from "../../../core/durable-write.ts";
import {
  canonicalJsonBytes,
  normalizeJson,
  readCanonicalObject,
  sha256Bytes,
} from "../../../core/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { writeIndex } from "../capsule/capsule-index.ts";
import {
  EVENT_SCHEMA,
  FORMAT_VERSION,
  isCheckpointSequence,
  type StoreLimits,
} from "../layout/constants.ts";
import { validateEventChain } from "./event-stream.ts";
import { runFilePath } from "../capsule/paths.ts";
import { diffProjection } from "../projections/projection-patch.ts";
import { businessFields, cloneObject, isTerminalState } from "../capsule/state.ts";
import { appendTraceStep } from "../recovery/trace.ts";
import {
  materializeProjections,
  materializedProjectionDigests,
} from "../projections/materialized-projections.ts";
import {
  TRANSACTION_MARKER_FILE,
  type TransactionPhase,
  type TransactionMarker,
  type AppendProjectionDependencies,
  CommittedWithRecoveryPendingError,
  isCommittedWithRecoveryPending,
  readTransactionMarker,
  transactionRecoveryStatus,
  clearTransactionMarker,
  markerPath,
  assertMarkerPath,
} from "./transaction-marker.ts";

export {
  TRANSACTION_MARKER_FILE,
  type TransactionPhase,
  type TransactionMarker,
  type AppendProjectionDependencies,
  CommittedWithRecoveryPendingError,
  isCommittedWithRecoveryPending,
  readTransactionMarker,
  transactionRecoveryStatus,
  clearTransactionMarker,
};

function writeTransactionMarker(runRoot: string, marker: TransactionMarker): TransactionMarker {
  assertMarkerPath(markerPath(runRoot));
  atomicWriteJson(markerPath(runRoot), marker, 0o600);
  return marker;
}

function checkedEventCommit(
  runRoot: string,
  manifest: Manifest,
  event: HarnessEvent,
  sequence: number,
): void {
  const chain = validateEventChain(
    runFilePath(runRoot, "events.jsonl"),
    { runId: manifest.run_id, capsuleId: manifest.capsule_id },
    {},
    false,
    true,
  );
  const matching = chain.events.at(-1);
  if (
    chain.issues.length > 0 ||
    chain.tornTail !== undefined ||
    chain.eventCount !== sequence ||
    chain.finalState.event_head !== event.hash ||
    matching?.hash !== event.hash
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `event ${sequence} did not validate as the durable canonical commit point`,
    );
  }
}

function refreshDerived(
  runRoot: string,
  manifest: Manifest,
  event: HarnessEvent,
  next: RunState,
  dependencies: AppendProjectionDependencies,
): void {
  const failures: string[] = [];
  try {
    (dependencies.materialize ?? materializeProjections)(runRoot, next);
  } catch (error) {
    failures.push(`${"materialized projections"}: ${String(error)}`);
  }
  try {
    appendTraceStep(runRoot, event);
  } catch (error) {
    failures.push(`trace.md: ${String(error)}`);
  }
  try {
    writeIndex(runRoot, next, manifest.run_id);
  } catch (error) {
    failures.push(`index.json: ${String(error)}`);
  }
  if (failures.length > 0)
    throw new HarnessError("INTEGRITY", `derived views failed to refresh: ${failures.join("; ")}`);
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
  dependencies: AppendProjectionDependencies = {},
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

  const next = { ...projection, event_head: event.hash };

  let marker = writeTransactionMarker(runRoot, {
    schema: "harness.transaction",
    version: 1,
    run_id: manifest.run_id,
    capsule_id: manifest.capsule_id,
    sequence,
    event_hash: event.hash,
    phase: "PREPARED",
    request_key:
      typeof payload.request_key === "string"
        ? payload.request_key
        : sha256Bytes(canonicalJsonBytes(payload)),
    payload_sha256: sha256Bytes(canonicalJsonBytes(payload)),
    semantic_schema: typeof payload.schema === "string" ? payload.schema : "",
    semantic_version: typeof payload.semantic_version === "number" ? payload.semantic_version : 0,
    authority_actor: typeof payload.authority_actor === "string" ? payload.authority_actor : actor,
    artifact_sha256: typeof payload.artifact_sha256 === "string" ? payload.artifact_sha256 : null,
    materialized_projections: [...materializedProjectionDigests(next)],
  });
  try {
    dependencies.beforeEventAppend?.();
    durableAppendBytes(eventPath, line);
    checkedEventCommit(runRoot, manifest, event, sequence);
  } catch (error) {
    try {
      clearTransactionMarker(runRoot);
    } catch (_ignored) {
    }
    throw error;
  }
  const pending = (phase: TransactionPhase, cause: unknown): never => {
    try {
      marker = writeTransactionMarker(runRoot, { ...marker, phase });
    } catch (_ignored) {
    }
    throw new CommittedWithRecoveryPendingError(marker, cloneObject(next), cause);
  };
  try {
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "EVENT_COMMITTED" });
    dependencies.afterEventCommit?.();
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "STATE_PENDING" });
    (dependencies.writeState ?? atomicWriteJson)(runFilePath(runRoot, "state.json"), next);
  } catch (error) {
    return pending("STATE_PENDING", error);
  }
  try {
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "PROJECTIONS_PENDING" });
    refreshDerived(runRoot, manifest, event, next, dependencies);
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "COMMITTED" });
    (dependencies.clearMarker ?? clearTransactionMarker)(runRoot);
  } catch (error) {
    return pending(marker.phase === "COMMITTED" ? "COMMITTED" : "PROJECTIONS_PENDING", error);
  }
  return cloneObject(next);
}
