import type { CommandAttemptRecord, CommandRecord } from "../core/contracts/index.ts";
import { atomicWriteJson } from "../core/durable-write.ts";
import type { inspectRepositoryBinding } from "../packets/repository-identity.ts";
import { assertCommandAttemptSize } from "../engine/runner/index.ts";
import { sameRepositoryObservation } from "../engine/runner/signing/gate-observation.ts";

const POST_INTERRUPTED = "gate post-observation interrupted before integrity finalization";
const REPOSITORY_DRIFT = "gate repository changed before durable integrity finalization";

export function recoverGateAttempt(
  intent: CommandRecord,
  candidate: CommandAttemptRecord,
  recordPath: string,
  inspectRepository: typeof inspectRepositoryBinding,
  now: () => Date,
): { attempt: CommandAttemptRecord; integrityFailed: boolean } {
  if (intent.gate_id === null) return { attempt: candidate, integrityFailed: false };
  let attempt = candidate;
  if (attempt.gate_finalized_at === undefined || attempt.repository_after === undefined) {
    attempt = {
      ...attempt,
      status: "failed",
      timeout_kind: null,
      gate_finalized_at: now().toISOString(),
      repository_after: structuredClone(inspectRepository(intent.repository_root)),
      integrity_failure: attempt.integrity_failure ?? POST_INTERRUPTED,
    };
  } else if (
    attempt.integrity_failure === undefined &&
    !sameRepositoryObservation(intent.repository_before!, attempt.repository_after)
  ) {
    attempt = {
      ...attempt,
      status: "failed",
      timeout_kind: null,
      integrity_failure: REPOSITORY_DRIFT,
    };
  }
  if (attempt !== candidate) {
    assertCommandAttemptSize(attempt);
    atomicWriteJson(recordPath, attempt, 0o600);
  }
  return { attempt, integrityFailed: attempt.integrity_failure !== undefined };
}
