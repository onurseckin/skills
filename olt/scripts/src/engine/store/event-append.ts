import { existsSync, lstatSync, unlinkSync } from "node:fs";
import type { HarnessEvent, Manifest, RunState } from "../../core/contracts/capsule.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import { atomicWriteJson, durableAppendBytes, fsyncDirectory } from "../../core/durable-write.ts";
import {
  canonicalJsonBytes,
  normalizeJson,
  readCanonicalObject,
  sha256Bytes,
} from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { writeIndex } from "./capsule-index.ts";
import {
  EVENT_SCHEMA,
  FORMAT_VERSION,
  isCheckpointSequence,
  type StoreLimits,
} from "./constants.ts";
import { validateEventChain } from "./event-stream.ts";
import { runFilePath } from "./paths.ts";
import { diffProjection } from "./projection-patch.ts";
import { businessFields, cloneObject, isTerminalState } from "./state.ts";
import { appendTraceStep } from "./trace.ts";

export const TRANSACTION_MARKER_FILE = ".transaction.json";
const TRANSACTION_SCHEMA = "harness.transaction";
const TRANSACTION_VERSION = 1;

export type TransactionPhase =
  | "PREPARED"
  | "EVENT_COMMITTED"
  | "STATE_PENDING"
  | "PROJECTIONS_PENDING"
  | "COMMITTED";

export interface TransactionMarker extends JsonObject {
  schema: typeof TRANSACTION_SCHEMA;
  version: typeof TRANSACTION_VERSION;
  run_id: string;
  capsule_id: string;
  sequence: number;
  event_hash: string;
  phase: TransactionPhase;
}

/** Narrow fault seam for transaction-boundary tests; omitted in every production caller. */
export interface AppendProjectionDependencies {
  beforeEventAppend?: () => void;
  writeState?: (path: string, state: RunState) => void;
}

/** The only error that proves an event passed the canonical durability boundary. */
export class CommittedWithRecoveryPendingError extends HarnessError {
  public readonly committed = true;

  public constructor(
    public readonly marker: TransactionMarker,
    public readonly state: RunState,
    cause: unknown,
  ) {
    super(
      "INTEGRITY",
      `event ${marker.sequence} (${marker.event_hash}) is committed with recovery pending at ${marker.phase}: ${String(cause)}`,
    );
    this.name = "CommittedWithRecoveryPendingError";
  }
}

export function isCommittedWithRecoveryPending(
  error: unknown,
): error is CommittedWithRecoveryPendingError {
  return error instanceof CommittedWithRecoveryPendingError;
}

function markerPath(runRoot: string): string {
  return runFilePath(runRoot, TRANSACTION_MARKER_FILE);
}

function assertMarkerPath(path: string): void {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${TRANSACTION_MARKER_FILE} must be a regular file`);
  if (metadata.nlink !== 1)
    throw new HarnessError(
      "INTEGRITY",
      `${TRANSACTION_MARKER_FILE} must have exactly one hard link`,
    );
}

function markerIsValid(value: Record<string, unknown>): value is TransactionMarker {
  return (
    value.schema === TRANSACTION_SCHEMA &&
    value.version === TRANSACTION_VERSION &&
    typeof value.run_id === "string" &&
    typeof value.capsule_id === "string" &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    typeof value.event_hash === "string" &&
    /^[0-9a-f]{64}$/u.test(value.event_hash) &&
    typeof value.phase === "string" &&
    ["PREPARED", "EVENT_COMMITTED", "STATE_PENDING", "PROJECTIONS_PENDING", "COMMITTED"].includes(
      value.phase,
    )
  );
}

export function readTransactionMarker(runRoot: string): TransactionMarker | undefined {
  const path = markerPath(runRoot);
  if (!existsSync(path)) return undefined;
  assertMarkerPath(path);
  let value: Record<string, unknown>;
  try {
    value = readCanonicalObject(path, TRANSACTION_MARKER_FILE);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `invalid ${TRANSACTION_MARKER_FILE}: ${String(error)}`);
  }
  if (!markerIsValid(value))
    throw new HarnessError("INTEGRITY", `invalid ${TRANSACTION_MARKER_FILE} schema`);
  return value;
}

export function transactionRecoveryStatus(runRoot: string): TransactionPhase | undefined {
  return readTransactionMarker(runRoot)?.phase;
}

function writeTransactionMarker(runRoot: string, marker: TransactionMarker): TransactionMarker {
  assertMarkerPath(markerPath(runRoot));
  atomicWriteJson(markerPath(runRoot), marker, 0o600);
  return marker;
}

export function clearTransactionMarker(runRoot: string): void {
  const path = markerPath(runRoot);
  if (!existsSync(path)) return;
  assertMarkerPath(path);
  unlinkSync(path);
  fsyncDirectory(runRoot);
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
): void {
  const failures: string[] = [];
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

  let marker = writeTransactionMarker(runRoot, {
    schema: TRANSACTION_SCHEMA,
    version: TRANSACTION_VERSION,
    run_id: manifest.run_id,
    capsule_id: manifest.capsule_id,
    sequence,
    event_hash: event.hash,
    phase: "PREPARED",
  });
  try {
    dependencies.beforeEventAppend?.();
    durableAppendBytes(eventPath, line);
    checkedEventCommit(runRoot, manifest, event, sequence);
  } catch (error) {
    // No acknowledged event fsync+validation means callers receive the original rejection.
    try {
      clearTransactionMarker(runRoot);
    } catch {
      // Cleanup cannot turn a pre-commit failure into a committed outcome.
    }
    throw error;
  }

  const next = { ...projection, event_head: event.hash };
  const pending = (phase: TransactionPhase, cause: unknown): never => {
    try {
      marker = writeTransactionMarker(runRoot, { ...marker, phase });
    } catch {
      // The most recently durable marker remains authoritative.
    }
    throw new CommittedWithRecoveryPendingError(marker, cloneObject(next), cause);
  };
  try {
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "EVENT_COMMITTED" });
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "STATE_PENDING" });
    (dependencies.writeState ?? atomicWriteJson)(runFilePath(runRoot, "state.json"), next);
  } catch (error) {
    return pending("STATE_PENDING", error);
  }
  try {
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "PROJECTIONS_PENDING" });
    refreshDerived(runRoot, manifest, event, next);
    marker = writeTransactionMarker(runRoot, { ...marker, phase: "COMMITTED" });
    clearTransactionMarker(runRoot);
  } catch (error) {
    return pending(marker.phase === "COMMITTED" ? "COMMITTED" : "PROJECTIONS_PENDING", error);
  }
  return cloneObject(next);
}
