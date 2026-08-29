import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CommandRecord } from "../../core/contracts/index.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { readCanonicalObject } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/index.ts";
import type { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import { applyAttempt, replaceFinalAttempt, updateRetryExhaustion } from "./command-aggregate.ts";
import {
  commandExecutionSnapshot,
  gateExecutionSnapshot,
  type CommandRuntimeCapability,
} from "./command-execution-snapshot.ts";
import {
  assertCommandAttemptSize,
  assertCommandRecordSize,
  boundedEvidenceError,
  MAX_COMMAND_ATTEMPTS,
  MAX_COMMAND_RECORD_BYTES,
} from "./command-record-size.ts";
import { embeddedCommandIssues, sameCommandJson } from "./command-shape.ts";
import { gateEnvironmentIssues } from "./gate-environment.ts";
import { assertGatePathBindings, executionArgv } from "./gate-path-bindings.ts";
import { finalizeGateAttempt } from "./gate-attempt-finalization.ts";
import { sameRepositoryObservation } from "./gate-observation.ts";
import { runAttempt } from "./run-attempt.ts";
import { AttemptExecutionError } from "./attempt-execution-error.ts";
import type { CommandSigningCapability } from "./attempt-disposition-capability.ts";
import { shouldRetry } from "./retry-policy.ts";
import type { AttemptResult, CommandResult, PreparedCommand } from "./types.ts";

export interface InternalExecutionDependencies {
  inspectRepository: typeof inspectRepositoryBinding;
  attempt: typeof runAttempt;
  createCommandSigner?: () => CommandSigningCapability;
}

const RETRY_PENDING = "command retry pending before next attempt start";

function publish(path: string, record: CommandRecord): void {
  assertCommandRecordSize(record);
  atomicWriteJson(path, record, 0o600);
}

function persistAttempt(commandRoot: string, result: AttemptResult): void {
  const directory = join(commandRoot, `attempt-${result.attempt}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertCommandAttemptSize(result.record);
  atomicWriteJson(join(directory, "record.json"), result.record, 0o600);
}

export async function executeInternalPreparedCommand(
  prepared: PreparedCommand,
  runtime: CommandRuntimeCapability,
  dependencies: InternalExecutionDependencies,
): Promise<CommandResult> {
  const durable = readCanonicalObject(runtime.recordPath, "prepared command intent", {
    maxBytes: MAX_COMMAND_RECORD_BYTES,
    maxDepth: 64,
  });
  if (!sameCommandJson(durable, prepared.record))
    throw new HarnessError("INTEGRITY", "prepared command does not match its durable intent");
  const record = structuredClone(durable) as unknown as CommandRecord;
  const issues = embeddedCommandIssues(record);
  if (issues.length > 0)
    throw new HarnessError("INTEGRITY", `prepared command intent is invalid: ${issues.join("; ")}`);
  if (record.status !== "running" || (record.attempts?.length ?? 0) !== 0)
    throw new HarnessError("INTEGRITY", "prepared command intent is not pristine");
  if (runtime.attemptSigner.verificationPublicKey !== record.attempt_signing_public_key) {
    throw new HarnessError(
      "INTEGRITY",
      "prepared command signing capability does not match durable intent",
    );
  }
  const snapshot = commandExecutionSnapshot(record, runtime);
  if (snapshot.retries + 1 > MAX_COMMAND_ATTEMPTS)
    throw new HarnessError("INTEGRITY", "command retry policy exceeds terminal capacity");
  const attempts: AttemptResult[] = [];
  let inGatePreflight = false;
  let preflightRepository: CommandRecord["repository_after"] = null;
  try {
    for (let attempt = 1; attempt <= snapshot.retries + 1; attempt += 1) {
      if (record.retry_pending) {
        delete record.retry_pending;
        delete record.evidence_error;
      }
      preflightRepository = null;
      inGatePreflight = record.gate_id !== null;
      if (record.gate_id) record.repository_after = null;
      const execution = record.gate_id
        ? (() => {
            const actual = structuredClone(dependencies.inspectRepository(record.repository_root));
            preflightRepository = actual;
            if (!sameRepositoryObservation(record.repository_before!, actual))
              throw new HarnessError(
                "INTEGRITY",
                "repository observation changed before gate attempt",
              );
            const envIssues = gateEnvironmentIssues(record.environment);
            if (envIssues.length > 0) throw new HarnessError("INTEGRITY", envIssues.join("; "));
            assertGatePathBindings(
              record.repository_root,
              record.cwd,
              record.argv,
              record.path_bindings,
              record.environment?.PATH,
            );
            return gateExecutionSnapshot(
              snapshot,
              [
                ...(record.execution_argv ??
                  executionArgv(record.argv, record.path_bindings ?? [])),
              ],
              structuredClone(record.environment ?? {}),
            );
          })()
        : snapshot;
      let executionFailure: AttemptExecutionError | undefined;
      let result: AttemptResult;
      try {
        result = await dependencies.attempt(
          execution,
          attempt,
          record.id,
          runtime.commandRoot,
          runtime.attemptSigner,
        );
      } catch (error) {
        if (!(error instanceof AttemptExecutionError)) throw error;
        executionFailure = error;
        result = error.result;
      }
      inGatePreflight = false;
      persistAttempt(runtime.commandRoot, result);
      attempts.push(result);
      applyAttempt(record, result);
      if (record.gate_id) {
        record.status = "running";
        record.finished_at = null;
      }
      publish(runtime.recordPath, record);
      if (record.gate_id) {
        const postIssues = finalizeGateAttempt(record, result, dependencies.inspectRepository);
        persistAttempt(runtime.commandRoot, result);
        replaceFinalAttempt(record, result.record);
        if (postIssues.length > 0 && !executionFailure) {
          delete record.retry_pending;
          const message = result.record.integrity_failure!;
          record.evidence_error = boundedEvidenceError(message);
          updateRetryExhaustion(record, null, false);
          publish(runtime.recordPath, record);
          throw new HarnessError("INTEGRITY", message);
        }
      }
      if (result.record.integrity_failure !== undefined) {
        delete record.retry_pending;
        record.evidence_error = boundedEvidenceError(result.record.integrity_failure);
        updateRetryExhaustion(record, result.failureClass, false);
        publish(runtime.recordPath, record);
        if (executionFailure) throw executionFailure.original;
        throw new HarnessError("INTEGRITY", result.record.integrity_failure);
      }
      const again = shouldRetry(
        result.failureClass,
        snapshot.idempotent,
        attempt,
        snapshot.retries,
      );
      updateRetryExhaustion(record, result.failureClass, again);
      if (again) {
        record.retry_pending = true;
        record.evidence_error = RETRY_PENDING;
      } else delete record.retry_pending;
      publish(runtime.recordPath, record);
      if (!again) break;
    }
  } catch (error) {
    const unreturned = join(
      runtime.commandRoot,
      `attempt-${(record.attempts?.length ?? 0) + 1}`,
      "attempt-started.json",
    );
    if (existsSync(unreturned)) {
      publish(runtime.recordPath, structuredClone(durable) as unknown as CommandRecord);
      throw error;
    }
    if (
      record.gate_id &&
      (record.attempts?.length ?? 0) > 0 &&
      record.attempts?.at(-1)?.gate_finalized_at === undefined
    )
      throw error;
    if (!record.evidence_error) {
      record.status = "failed";
      record.finished_at = new Date().toISOString();
      record.evidence_error = boundedEvidenceError(error);
      if (inGatePreflight) {
        record.repository_after = preflightRepository;
        record.preflight_failure = record.evidence_error;
      }
    }
    publish(runtime.recordPath, record);
    throw error;
  }
  return { record: structuredClone(record), attempts, recordPath: runtime.recordPath };
}
