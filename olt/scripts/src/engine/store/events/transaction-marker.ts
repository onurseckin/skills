import { existsSync, lstatSync, unlinkSync } from "node:fs";
import type { JsonObject, RunState } from "../../../core/contracts/index.ts";
import { atomicWriteJson, fsyncDirectory } from "../../../core/durable-write.ts";
import { readCanonicalObject } from "../../../core/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { runFilePath } from "../capsule/paths.ts";

export const TRANSACTION_MARKER_FILE = ".transaction.json";
export const TRANSACTION_SCHEMA = "harness.transaction";
export const TRANSACTION_VERSION = 1;

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
  request_key: string;
  payload_sha256: string;
  semantic_schema: string;
  semantic_version: number;
  authority_actor: string;
  artifact_sha256: string | null;
  materialized_projections: JsonObject[];
}

export interface AppendProjectionDependencies {
  beforeEventAppend?: () => void;
  afterEventCommit?: () => void;
  writeState?: (path: string, state: RunState) => void;
  materialize?: (runRoot: string, state: RunState) => void;
  clearMarker?: (runRoot: string) => void;
}

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

export function markerPath(runRoot: string): string {
  return runFilePath(runRoot, TRANSACTION_MARKER_FILE);
}

export function assertMarkerPath(path: string): void {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${TRANSACTION_MARKER_FILE} must be a regular file`);
  if (metadata.nlink !== 1)
    throw new HarnessError(
      "INTEGRITY",
      `${TRANSACTION_MARKER_FILE} must not have hard links (nlink=${metadata.nlink})`,
    );
}

export function markerIsValid(value: Record<string, unknown>): value is TransactionMarker {
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
    typeof value.request_key === "string" &&
    /^[0-9a-f]{64}$/u.test(value.request_key) &&
    /^[0-9a-f]{64}$/u.test(value.payload_sha256 as string) &&
    typeof value.semantic_schema === "string" &&
    Number.isSafeInteger(value.semantic_version) &&
    typeof value.authority_actor === "string" &&
    value.authority_actor.length > 0 &&
    (value.artifact_sha256 === null ||
      (typeof value.artifact_sha256 === "string" &&
        /^[0-9a-f]{64}$/u.test(value.artifact_sha256))) &&
    ["PREPARED", "EVENT_COMMITTED", "STATE_PENDING", "PROJECTIONS_PENDING", "COMMITTED"].includes(
      value.phase as string,
    ) &&
    Array.isArray(value.materialized_projections)
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

export function writeTransactionMarker(
  runRoot: string,
  marker: TransactionMarker,
): TransactionMarker {
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
