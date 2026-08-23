import { existsSync } from "node:fs";
import { posix } from "node:path";
import type { CommandAttemptRecord, CommandRecord } from "../contracts/commands.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import { readCanonicalObject } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { inspectRepositoryBinding } from "../packets/repository-identity.ts";
import { probeAttemptProcess } from "../runner/attempt-intent.ts";
import { resolveArtifactPath } from "../runner/artifact-paths.ts";
import {
  applyAttemptRecord,
  transientFailure,
  updateRetryExhaustion,
} from "../runner/command-aggregate.ts";
import { embeddedCommandIssues } from "../runner/command-shape.ts";
import {
  assertCommandAttemptSize,
  assertCommandRecordSize,
  MAX_COMMAND_ATTEMPT_BYTES,
} from "../runner/command-record-size.ts";
import { verifyCommandAttempt } from "../runner/verify-command.ts";
import { recoverGateAttempt } from "./recover-gate-attempt.ts";
import {
  recoverIncomplete,
  type AttemptReconciliationDependencies,
} from "./incomplete-attempt-recovery.ts";

export type { AttemptReconciliationDependencies };

const defaults: AttemptReconciliationDependencies = {
  probeProcess: probeAttemptProcess,
  inspectRepository: inspectRepositoryBinding,
  now: () => new Date(),
};

export function recoverAggregateFromAttempts(
  runRoot: string,
  intent: CommandRecord,
  injected: Partial<AttemptReconciliationDependencies> = {},
): CommandRecord | undefined {
  const dependencies = { ...defaults, ...injected };
  const recovered = structuredClone(intent);
  recovered.attempts = [];
  const commandDirectory = posix.dirname(intent.record_path);
  const maximum = (intent.policy?.max_retries ?? 0) + 1;
  let gateInterrupted = false;
  for (let index = 0; index < maximum; index += 1) {
    const base = `${commandDirectory}/attempt-${index + 1}`;
    const directory = resolveArtifactPath(runRoot, base);
    const recordPath = `${directory}/record.json`;
    const startedPath = `${directory}/attempt-started.json`;
    let attempt: CommandAttemptRecord;
    if (existsSync(recordPath)) {
      attempt = readCanonicalObject(recordPath, `command ${intent.id} attempt ${index + 1}`, {
        maxBytes: MAX_COMMAND_ATTEMPT_BYTES,
        maxDepth: 32,
      }) as unknown as CommandAttemptRecord;
    } else if (existsSync(startedPath)) {
      const interrupted = recoverIncomplete(runRoot, intent, directory, index + 1, dependencies);
      if (!interrupted) return undefined;
      attempt = interrupted;
    } else break;
    assertCommandAttemptSize(attempt);
    const finalized = recoverGateAttempt(
      intent,
      attempt,
      recordPath,
      dependencies.inspectRepository,
      dependencies.now,
    );
    attempt = finalized.attempt;
    gateInterrupted = finalized.integrityFailed;
    const issues = verifyCommandAttempt(runRoot, intent, attempt, index);
    if (issues.length > 0)
      throw new HarnessError(
        "INTEGRITY",
        `durable command attempt is invalid: ${issues.join("; ")}`,
      );
    applyAttemptRecord(recovered, attempt);
    if (gateInterrupted) break;
  }
  if ((recovered.attempts?.length ?? 0) === 0) return undefined;
  const extra = resolveArtifactPath(runRoot, `${commandDirectory}/attempt-${maximum + 1}`);
  if (existsSync(`${extra}/record.json`) || existsSync(`${extra}/attempt-started.json`))
    throw new HarnessError("INTEGRITY", "durable command attempts exceed retry policy");
  const last = recovered.attempts!.at(-1)!;
  if (intent.gate_id !== null) recovered.repository_after = structuredClone(last.repository_after!);
  updateRetryExhaustion(recovered, last.integrity_failure ? null : last.failure_class, false);
  if (last.integrity_failure) recovered.evidence_error = last.integrity_failure;
  else if (transientFailure(last.failure_class) && !recovered.retry_exhausted)
    recovered.evidence_error =
      "command stopped after durable attempt evidence before retry reconciliation";
  const shapeIssues = embeddedCommandIssues(recovered);
  if (shapeIssues.length > 0)
    throw new HarnessError(
      "INTEGRITY",
      `recovered command aggregate is invalid: ${shapeIssues.join("; ")}`,
    );
  assertCommandRecordSize(recovered);
  atomicWriteJson(resolveArtifactPath(runRoot, intent.record_path), recovered, 0o600);
  return recovered;
}
