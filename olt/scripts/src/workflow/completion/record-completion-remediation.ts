import { HarnessError } from "../../core/errors/harness-error.ts";
import { requireText, utc } from "../task-state.ts";
import {
  systemClock,
  type Clock,
  type CompletionFindingResolution,
  type CompletionRemediation,
  type TransactionPort,
} from "../types.ts";
import { authoritativeRepositoryCommand } from "./repository-evidence.ts";
import { jsonDigest } from "./completion-review-digest.ts";

function resolutions(value: unknown): CompletionFindingResolution[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HarnessError("INVALID_ARGUMENT", "completion resolutions must be nonempty");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new HarnessError("INVALID_ARGUMENT", "completion resolution must be an object");
    const input = raw as Record<string, unknown>;
    const findingId = requireText(input.finding_id, "finding_id");
    if (seen.has(findingId))
      throw new HarnessError("INVALID_ARGUMENT", `duplicate completion resolution: ${findingId}`);
    seen.add(findingId);
    const method = requireText(input.method, "method");
    if (
      !Array.isArray(input.command_ids) ||
      input.command_ids.length === 0 ||
      input.command_ids.some((id) => typeof id !== "string" || id.trim() === "") ||
      new Set(input.command_ids).size !== input.command_ids.length
    )
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "resolution command_ids must be nonempty and unique",
      );
    return { finding_id: findingId, method, command_ids: [...input.command_ids] as string[] };
  });
}

export function recordCompletionRemediation(
  port: TransactionPort,
  actor: string,
  value: unknown,
  clock: Clock = systemClock,
) {
  actor = requireText(actor, "actor");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", "completion remediation must be an object");
  const input = value as Record<string, unknown>;
  const reviewSha = requireText(input.review_sha256, "review_sha256");
  const parsed = resolutions(input.resolutions);
  const now = clock.now();
  return port.transact(actor, "completion-remediated", { review_sha256: reviewSha }, (draft) => {
    if (draft.completion_result?.status === "complete")
      throw new HarnessError("INVALID_STATE", "run is already completed");
    const review = draft.completion_review;
    if (!review || review.review_sha256 !== reviewSha || review.status !== "findings")
      throw new HarnessError(
        "INVALID_STATE",
        "remediation does not match the latest findings review",
      );
    if ((draft.completion_remediations ?? []).some((entry) => entry.review_sha256 === reviewSha))
      throw new HarnessError("INVALID_STATE", "completion review is already remediated");
    const expected = [...review.unresolved_finding_ids].sort();
    const actual = parsed.map((entry) => entry.finding_id).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new HarnessError(
        "INVALID_STATE",
        "remediation must resolve every reviewed finding exactly",
      );
    for (const resolution of parsed)
      for (const id of resolution.command_ids)
        if (!authoritativeRepositoryCommand(draft, id))
          throw new HarnessError("INVALID_STATE", `remediation command evidence is invalid: ${id}`);
    const base = { actor, review_sha256: reviewSha, resolutions: parsed, recorded_at: utc(now) };
    const remediation = {
      ...base,
      remediation_sha256: jsonDigest(base),
    } as CompletionRemediation;
    draft.completion_remediations ??= [];
    draft.completion_remediations.push(remediation);
  });
}
