import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type {
  CommandAttemptCleanupDisposition,
  CommandAttemptStartedRecord,
} from "../contracts/commands.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  boundedReason,
  cleanupDispositionEntryDigest,
  cleanupDispositionSigningBytes,
  MAX_CLEANUP_HISTORY,
  type CleanupDispositionPayload,
  type CleanupProofKind,
  type DispositionStatus,
} from "./attempt-cleanup-signature.ts";
import { sameProcessIdentity } from "./process-identity.ts";
import type {
  AttemptDispositionCapability,
  AttemptTerminalProof,
} from "./attempt-disposition-capability.ts";

export const CREATE_ATTEMPT_DISPOSITION: unique symbol = Symbol("create-attempt-disposition");
type AttemptSignal = "SIGKILL" | "SIGTERM";

export interface CommandSigningCapability {
  readonly verificationPublicKey: string;
  readonly [CREATE_ATTEMPT_DISPOSITION]: (path: string) => AttemptDispositionCapability;
}

export function createCommandSigningCapability(): CommandSigningCapability {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const encoded = publicKey.export({ format: "der", type: "spki" });
  const verificationPublicKey = Buffer.from(encoded).toString("base64");
  return Object.freeze({
    verificationPublicKey,
    [CREATE_ATTEMPT_DISPOSITION]: (path: string) =>
      createAttemptDispositionCapabilityWithKey(path, verificationPublicKey, privateKey),
  });
}

export function createAttemptDispositionCapabilityWithKey(
  path: string,
  verificationPublicKey: string,
  privateKey: KeyObject,
): AttemptDispositionCapability {
  const append = (
    record: CommandAttemptStartedRecord,
    status: DispositionStatus,
    proofKind: CleanupProofKind,
    reason: string,
    signals: readonly AttemptSignal[],
  ): CommandAttemptStartedRecord => {
    if (record.cleanup_history.length >= MAX_CLEANUP_HISTORY)
      throw new HarnessError("INVALID_STATE", "attempt cleanup disposition history is exhausted");
    const previous = record.cleanup_history.at(-1);
    const payload: CleanupDispositionPayload = {
      status,
      sequence: record.cleanup_history.length + 1,
      recorded_at: new Date().toISOString(),
      reason: boundedReason(reason),
      signals_sent: [...signals],
      root_pid_identity: record.root_pid_identity ? { ...record.root_pid_identity } : null,
      proof_kind: proofKind,
      previous_sha256: record.disposition_head_sha256,
      previous_signature: previous?.signature ?? null,
    };
    const signature = sign(
      null,
      cleanupDispositionSigningBytes(record.base_sha256, payload),
      privateKey,
    ).toString("base64");
    const cleanupDisposition: CommandAttemptCleanupDisposition = {
      ...payload,
      signature,
      sha256: cleanupDispositionEntryDigest(record.base_sha256, payload, signature),
    };
    const updated: CommandAttemptStartedRecord = {
      ...record,
      disposition_head_sha256: cleanupDisposition.sha256,
      cleanup_disposition: cleanupDisposition,
      cleanup_history: [...record.cleanup_history, cleanupDisposition],
    };
    atomicWriteJson(path, updated, 0o600);
    return updated;
  };
  return {
    verificationPublicKey,
    initialize(baseRecord, bindRoot, observe) {
      let record = append(
        baseRecord,
        "uncertain",
        null,
        "attempt has no durable terminal proof",
        [],
      );
      const initialRecord = record;
      const currentSignals = (): AttemptSignal[] =>
        (record.cleanup_disposition?.signals_sent ?? []) as AttemptSignal[];
      const assertNotTerminal = (): void => {
        if (record.cleanup_disposition?.status === "terminal_proof")
          throw new HarnessError("INVALID_STATE", "attempt terminal proof is final");
      };
      return {
        record: initialRecord,
        controller: {
          bindRoot(identity) {
            observe(identity);
            if (identity) {
              if (record.root_pid_identity || record.cleanup_disposition?.status !== "uncertain")
                throw new HarnessError(
                  "INVALID_STATE",
                  "attempt root identity transition is invalid",
                );
              record = bindRoot(record, identity);
              record = append(
                record,
                "uncertain",
                null,
                "attempt root identity is durably bound",
                currentSignals(),
              );
            }
            return identity;
          },
          beginCleanupUncertain(issues) {
            assertNotTerminal();
            record = append(record, "uncertain", null, issues.join("; "), currentSignals());
          },
          recordSignal(signal) {
            assertNotTerminal();
            if (signal !== "SIGTERM" && signal !== "SIGKILL")
              throw new HarnessError(
                "INVALID_STATE",
                `unsupported attempt cleanup signal: ${signal}`,
              );
            if (record.cleanup_disposition?.status !== "uncertain")
              throw new HarnessError("INVALID_STATE", "signal delivery lacks cleanup uncertainty");
            const signals = currentSignals();
            if (signals.includes(signal)) return;
            if (signal === "SIGKILL" && !signals.includes("SIGTERM"))
              throw new HarnessError("INVALID_STATE", "attempt cleanup signal order is invalid");
            record = append(
              record,
              "uncertain",
              null,
              record.cleanup_disposition.reason,
              [...signals, signal],
            );
          },
          markRecordPending(reason) {
            assertNotTerminal();
            if (record.cleanup_disposition?.status !== "uncertain")
              throw new HarnessError(
                "INVALID_STATE",
                "record-pending transition requires uncertainty",
              );
            record = append(record, "record_pending", null, reason, currentSignals());
          },
          markTerminalProof(reason, proof: AttemptTerminalProof) {
            assertNotTerminal();
            if (record.cleanup_disposition?.status !== "record_pending")
              throw new HarnessError(
                "INVALID_STATE",
                "terminal-proof transition requires record-pending",
              );
            const bound = record.root_pid_identity ?? undefined;
            const rootMatches = bound
              ? sameProcessIdentity(bound, proof.rootIdentity)
              : proof.rootIdentity === undefined;
            if (
              (proof.kind !== "settled" && proof.kind !== "strong_absence") ||
              proof.childSettled !== true ||
              proof.descendantsAbsent !== true ||
              !rootMatches ||
              (proof.kind === "strong_absence" && (!bound || proof.rootAbsent !== true)) ||
              (proof.kind === "settled" && proof.rootAbsent !== false)
            )
              throw new HarnessError("INVALID_STATE", "terminal process proof is invalid");
            record = append(record, "terminal_proof", proof.kind, reason, currentSignals());
          },
        },
      };
    },
  };
}
