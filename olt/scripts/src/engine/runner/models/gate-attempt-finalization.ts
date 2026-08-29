import type { CommandRecord } from "../../../core/contracts/index";
import type { inspectRepositoryBinding } from "../../../packets/repository-identity";
import { boundedEvidenceError } from "./command-record-size";
import { gatePathBindingIssues } from "../signing/gate-path-bindings";
import { sameRepositoryObservation } from "../signing/gate-observation";
import type { AttemptResult } from "../types/types";

export function finalizeGateAttempt(
  record: CommandRecord,
  result: AttemptResult,
  inspectRepository: typeof inspectRepositoryBinding,
): string[] {
  const issues = gatePathBindingIssues(
    record.repository_root,
    record.cwd,
    record.argv,
    record.path_bindings,
    record.environment?.PATH,
  );
  const actual = structuredClone(inspectRepository(record.repository_root));
  record.repository_after = actual;
  if (!sameRepositoryObservation(record.repository_before!, actual))
    issues.unshift("repository changed after gate attempt");
  const postFailure =
    issues.length > 0 ? `post-attempt gate integrity failed: ${issues.join("; ")}` : undefined;
  const integrityFailure = [result.record.integrity_failure, postFailure]
    .filter((value): value is string => value !== undefined)
    .join("; ");
  result.record = {
    ...result.record,
    gate_finalized_at: new Date().toISOString(),
    ...(record.repository_after ? { repository_after: record.repository_after } : {}),
    ...(integrityFailure
      ? {
          status: "failed" as const,
          integrity_failure: boundedEvidenceError(integrityFailure),
        }
      : {}),
  };
  return issues;
}
