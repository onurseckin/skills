import { dirname, join } from "node:path";
import type {
  CommandAttemptStartedRecord,
  CommandProcessIdentity,
} from "../../core/contracts/index.ts";
import { atomicWriteJson, fsyncDirectory } from "../../core/durable-write.ts";
import { attemptStartedBaseDigest } from "./attempt-cleanup-disposition.ts";
import {
  createAttemptDispositionCapability,
  type AttemptDispositionCapability,
  type AttemptIntentController,
  type CommandSigningCapability,
} from "./attempt-disposition-capability.ts";
import type { ProcessIdentity } from "./process-identity.ts";
import {
  attemptStartedIssues,
  ownershipTokenDigest,
  probeAttemptProcess,
  retainedActivityTimes,
  type AttemptProcessProof,
} from "./attempt-intent-validation.ts";

export {
  settledAttemptTerminalProof,
  strongAttemptTerminalProof,
  type AttemptTerminalProof,
} from "./attempt-disposition-capability.ts";
export {
  attemptStartedIssues,
  ownershipTokenDigest,
  probeAttemptProcess,
  retainedActivityTimes,
  type AttemptProcessProof,
} from "./attempt-intent-validation.ts";
export type { AttemptIntentController } from "./attempt-disposition-capability.ts";

export function attemptStartedPath(attemptDirectory: string): string {
  return join(attemptDirectory, "attempt-started.json");
}

export function writeAttemptStarted(
  attemptDirectory: string,
  commandId: string,
  attempt: number,
  startedAt: string,
  ownershipToken: string,
  commandSigner: CommandSigningCapability,
  syncParent: (path: string) => void = fsyncDirectory,
): CommandAttemptStartedRecord {
  const capability = createAttemptDispositionCapability(
    attemptStartedPath(attemptDirectory),
    commandSigner,
  );
  return initializeAttemptStarted(
    attemptDirectory,
    commandId,
    attempt,
    startedAt,
    ownershipToken,
    capability,
    syncParent,
    () => undefined,
  ).record;
}

function initializeAttemptStarted(
  attemptDirectory: string,
  commandId: string,
  attempt: number,
  startedAt: string,
  ownershipToken: string,
  capability: AttemptDispositionCapability,
  syncParent: (path: string) => void,
  observe: (identity: ProcessIdentity | undefined) => void,
): { record: CommandAttemptStartedRecord; controller: AttemptIntentController } {
  const base = {
    schema: "harness.command-attempt-started",
    version: 1,
    command_id: commandId,
    attempt,
    status: "running",
    started_at: startedAt,
    ownership_token_sha256: ownershipTokenDigest(ownershipToken),
    verification_public_key: capability.verificationPublicKey,
  } as const;
  const baseSha256 = attemptStartedBaseDigest(base);
  const record: CommandAttemptStartedRecord = {
    ...base,
    root_pid_identity: null,
    base_sha256: baseSha256,
    disposition_head_sha256: baseSha256,
    cleanup_disposition: null,
    cleanup_history: [],
  };
  syncParent(dirname(attemptDirectory));
  atomicWriteJson(attemptStartedPath(attemptDirectory), record, 0o600);
  return capability.initialize(
    record,
    (current, identity) => bindAttemptRootIdentity(attemptDirectory, current, identity),
    observe,
  );
}

export function bindAttemptRootIdentity(
  attemptDirectory: string,
  record: CommandAttemptStartedRecord,
  identity: ProcessIdentity,
): CommandAttemptStartedRecord {
  const bound = {
    ...record,
    root_pid_identity: { ...identity } as CommandProcessIdentity,
  };
  atomicWriteJson(attemptStartedPath(attemptDirectory), bound, 0o600);
  return bound;
}

export function startAttemptIntent(
  attemptDirectory: string,
  commandId: string,
  attempt: number,
  startedAt: string,
  ownershipToken: string,
  observe: (identity: ProcessIdentity | undefined) => void,
  commandSigner: CommandSigningCapability,
): AttemptIntentController {
  const capability = createAttemptDispositionCapability(
    attemptStartedPath(attemptDirectory),
    commandSigner,
  );
  return initializeAttemptStarted(
    attemptDirectory,
    commandId,
    attempt,
    startedAt,
    ownershipToken,
    capability,
    fsyncDirectory,
    observe,
  ).controller;
}
