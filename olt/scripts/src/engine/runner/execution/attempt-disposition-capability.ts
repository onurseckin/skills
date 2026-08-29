import type { CommandAttemptStartedRecord } from "../../../core/contracts/index";
import type { CleanupProofKind } from "./attempt-cleanup-disposition";
import type { ProcessIdentity } from "../process/process-identity";
import {
  CREATE_ATTEMPT_DISPOSITION,
  createCommandSigningCapability as makeCommandSigner,
  type CommandSigningCapability,
} from "../models/command-signing-capability";

export { makeCommandSigner as createCommandSigningCapability };
export type { CommandSigningCapability };

const TERMINAL_PROOF_CAPABILITY: unique symbol = Symbol("attempt-terminal-proof");

export interface AttemptTerminalProof {
  readonly [TERMINAL_PROOF_CAPABILITY]: true;
  kind: Exclude<CleanupProofKind, null>;
  childSettled: true;
  descendantsAbsent: true;
  rootAbsent: boolean;
  rootIdentity: ProcessIdentity | undefined;
}

export function settledAttemptTerminalProof(
  rootIdentity: ProcessIdentity | undefined,
): AttemptTerminalProof {
  return Object.freeze({
    [TERMINAL_PROOF_CAPABILITY]: true as const,
    kind: "settled" as const,
    childSettled: true as const,
    descendantsAbsent: true as const,
    rootAbsent: false,
    rootIdentity: rootIdentity ? { ...rootIdentity } : undefined,
  });
}

export function strongAttemptTerminalProof(rootIdentity: ProcessIdentity): AttemptTerminalProof {
  return Object.freeze({
    [TERMINAL_PROOF_CAPABILITY]: true as const,
    kind: "strong_absence" as const,
    childSettled: true as const,
    descendantsAbsent: true as const,
    rootAbsent: true,
    rootIdentity: { ...rootIdentity },
  });
}

export interface AttemptIntentController {
  bindRoot(identity: ProcessIdentity | undefined): ProcessIdentity | undefined;
  beginCleanupUncertain(issues: readonly string[]): void;
  recordSignal(signal: NodeJS.Signals): void;
  markRecordPending(reason: string): void;
  markTerminalProof(reason: string, proof: AttemptTerminalProof): void;
}

type BindRoot = (
  record: CommandAttemptStartedRecord,
  identity: ProcessIdentity,
) => CommandAttemptStartedRecord;

export interface AttemptDispositionCapability {
  verificationPublicKey: string;
  initialize(
    record: CommandAttemptStartedRecord,
    bindRoot: BindRoot,
    observe: (identity: ProcessIdentity | undefined) => void,
  ): { record: CommandAttemptStartedRecord; controller: AttemptIntentController };
}

export function createAttemptDispositionCapability(
  path: string,
  commandSigner: CommandSigningCapability,
): AttemptDispositionCapability {
  return commandSigner[CREATE_ATTEMPT_DISPOSITION](path);
}
