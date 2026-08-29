import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import type { Manifest, RunState } from "../../../core/contracts/index.ts";
import { atomicWriteJson } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { withRunLock } from "../../../platform/index.ts";
import { validateEventChain } from "../events/event-stream.ts";
import {
  appendProjectionEvent,
  clearTransactionMarker,
  readTransactionMarker,
  type TransactionMarker,
} from "../events/event-append.ts";
import { quarantineAndTruncateTail } from "./forensic-tail.ts";
import { throwIntegrity } from "../integrity/issues.ts";
import { checkManifest } from "../layout/manifest.ts";
import { runFilePath } from "../capsule/paths.ts";
import { cloneObject } from "../capsule/state.ts";
import { limits } from "../layout/constants.ts";
import { writeIndex } from "../capsule/capsule-index.ts";
import { writeTrace } from "./trace.ts";
import {
  materializedProjectionDigests,
  materializeProjections,
} from "../projections/materialized-projections.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../core/json.ts";

function quarantineDirectory(runRoot: string): string {
  const path = runFilePath(runRoot, "quarantine");
  mkdirSync(path, { recursive: true, mode: 0o755 });
  return path;
}

function assertRecoverableStatePath(runRoot: string): void {
  const path = runFilePath(runRoot, "state.json");
  try {
    if (!lstatSync(path).isFile())
      throw new HarnessError("INTEGRITY", "state.json is not a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function recoverProjection(runRoot: string, actor: string): RunState {
  if (typeof actor !== "string" || !actor.trim())
    throw new HarnessError("INVALID_ARGUMENT", "actor must be a non-blank string");
  const metadata = lstatSync(runRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("INVALID_ARGUMENT", `run_root must be a real directory: ${runRoot}`);
  const root = realpathSync(runRoot);
  return withRunLock(root, () => recoverProjectionLocked(root, actor));
}

/** Internal only: callers already holding the exclusive capsule lock use this to
 * prevent a recovery/repair window between the marker check and materialization. */
export function recoverProjectionLocked(root: string, actor: string): RunState {
  const immutable = checkManifest(root);
  if (immutable.issues.length > 0 || !immutable.manifest) throwIntegrity(immutable.issues);
  const marker = readTransactionMarker(root);
  if (marker === undefined) assertRecoverableStatePath(root);
  const eventsPath = runFilePath(root, "events.jsonl");
  const chain = validateEventChain(
    eventsPath,
    { runId: immutable.manifest.run_id, capsuleId: immutable.manifest.capsule_id },
    {},
    false,
    true,
  );
  if (chain.issues.length > 0) throwIntegrity(chain.issues);
  if (chain.eventCount === 0)
    throw new HarnessError("INTEGRITY", "cannot recover state because there is no valid event");
  if (marker !== undefined)
    return recoverCommittedTransaction(root, immutable.manifest, chain, marker);
  const quarantined = chain.tornTail !== undefined;
  if (quarantined) {
    quarantineAndTruncateTail(eventsPath, chain.completeBytes, quarantineDirectory(root));
  }
  return appendProjectionEvent(
    root,
    immutable.manifest,
    chain.finalState,
    actor,
    "projection-recovered",
    { recovered_sequence: chain.eventCount, quarantined_torn_tail: quarantined },
    cloneObject(chain.finalState),
    limits(),
  );
}

function recoverCommittedTransaction(
  runRoot: string,
  manifest: Manifest,
  chain: ReturnType<typeof validateEventChain>,
  marker: TransactionMarker,
): RunState {
  if (
    marker.run_id !== manifest.run_id ||
    marker.capsule_id !== manifest.capsule_id ||
    marker.sequence !== chain.eventCount ||
    chain.finalState.event_head !== marker.event_hash ||
    chain.events.at(-1)?.hash !== marker.event_hash ||
    chain.tornTail !== undefined
  ) {
    throw new HarnessError(
      "INTEGRITY",
      "transaction marker does not match one unambiguous canonical event-chain head",
    );
  }
  const committed = chain.events.at(-1);
  if (
    committed === undefined ||
    sha256Bytes(canonicalJsonBytes(committed.payload)) !== marker.payload_sha256 ||
    (Object.hasOwn(committed.payload, "request_key") &&
      committed.payload["request_key"] !== marker.request_key) ||
    (marker.semantic_schema !== "" && committed.payload["schema"] !== marker.semantic_schema) ||
    (marker.semantic_version !== 0 &&
      committed.payload["semantic_version"] !== marker.semantic_version) ||
    committed.actor !== marker.authority_actor ||
    (marker.artifact_sha256 !== null &&
      committed.payload["artifact_sha256"] !== marker.artifact_sha256)
  ) {
    throw new HarnessError(
      "INTEGRITY",
      "transaction marker authoritative identity does not match the canonical committed event",
    );
  }
  const expectedProjections = materializedProjectionDigests(chain.finalState);
  if (
    marker.artifact_sha256 !== null &&
    !expectedProjections.some((projection) => projection["sha256"] === marker.artifact_sha256)
  ) {
    throw new HarnessError(
      "INTEGRITY",
      "transaction marker artifact digest does not match canonical final state",
    );
  }
  if (
    Buffer.compare(
      Buffer.from(canonicalJsonBytes(marker.materialized_projections)),
      Buffer.from(canonicalJsonBytes([...expectedProjections])),
    ) !== 0
  ) {
    throw new HarnessError(
      "INTEGRITY",
      "transaction marker materialized projections do not match canonical final state",
    );
  }
  atomicWriteJson(runFilePath(runRoot, "state.json"), chain.finalState);
  materializeProjections(runRoot, chain.finalState);
  writeTrace(runRoot, chain.events);
  writeIndex(runRoot, chain.finalState, manifest.run_id);
  clearTransactionMarker(runRoot);
  return cloneObject(chain.finalState);
}
