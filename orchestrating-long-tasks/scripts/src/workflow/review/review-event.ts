import type { JsonObject } from "../../contracts/json.ts";
import type { Finding } from "../../contracts/workflow.ts";
import type { TaskRecord } from "../types.ts";
import { findingClassOf, type FindingClass } from "./finding-class.ts";

/**
 * The `review-recorded` payload. Enrichment is forward-only: capsules written before it carry
 * `task_id` alone, so a consumer must treat every other field as optional rather than reading a
 * missing verdict as a rejection.
 */
export interface ReviewRecordedPayload extends JsonObject {
  task_id: string;
  verdict: "pass" | "reject";
  /** Repair round the task stands at once this verdict is recorded. */
  round: number;
  /** Findings this verdict records on the task; a pass records none. */
  finding_count: number;
  /** Class shared by the findings this verdict concerns; omitted when they do not share one. */
  class?: FindingClass;
  /** Open findings this pass closes; omitted on a rejection, which closes none. */
  resolved_count?: number;
}

/** What a capsule written before the enrichment carries, and all a consumer may rely on. */
export type ThinReviewRecordedPayload = { task_id: string };

/** What the payload is computed from, whether the review is still raw or already validated. */
export interface ReviewShape {
  verdict: "pass" | "reject" | null;
  findings: readonly JsonObject[];
  resolvedIds: readonly string[];
}

function findingsWithIds(task: TaskRecord, ids: readonly string[]): Finding[] {
  const byId = new Map((task.findings ?? []).map((finding) => [finding.id, finding]));
  return ids.flatMap((id) => {
    const finding = byId.get(id);
    return finding === undefined ? [] : [finding];
  });
}

/**
 * A single label can only describe findings that agree, so a mixed set carries none rather than
 * the class of whichever finding happened to come first.
 */
function sharedClass(findings: readonly JsonObject[]): FindingClass | null {
  if (findings.length === 0) return null;
  const declared = findings.map((finding) => findingClassOf(finding as Finding));
  const [first] = declared;
  if (first === undefined || first === null) return null;
  return declared.every((entry) => entry === first) ? first : null;
}

/** Tolerant read of an unvalidated review: an unrecognised shape yields absence, never a guess. */
export function readReviewShape(value: unknown): ReviewShape {
  const review =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const verdict = review.verdict === "pass" || review.verdict === "reject" ? review.verdict : null;
  const findings = Array.isArray(review.findings)
    ? review.findings.filter(
        (entry): entry is JsonObject =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : [];
  const resolvedIds = Array.isArray(review.resolved_findings)
    ? review.resolved_findings.flatMap((entry) => {
        const id =
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).finding_id
            : undefined;
        return typeof id === "string" ? [id] : [];
      })
    : [];
  return { verdict, findings, resolvedIds };
}

/**
 * Built before the transaction opens, because the store seals the payload before the mutation runs.
 * A review whose verdict cannot be read yet describes nothing, so it keeps the thin payload; the
 * validation inside the transaction rejects it before any event is appended.
 */
export function reviewRecordedPayload(
  taskId: string,
  task: TaskRecord,
  shape: ReviewShape,
): ReviewRecordedPayload | ThinReviewRecordedPayload {
  if (shape.verdict === null) return { task_id: taskId };
  const rejecting = shape.verdict === "reject";
  const recorded = rejecting ? shape.findings : [];
  const resolved = rejecting ? [] : findingsWithIds(task, shape.resolvedIds);
  const declared = sharedClass(rejecting ? recorded : resolved);
  return {
    task_id: taskId,
    verdict: shape.verdict,
    round: task.repair_round + (rejecting ? 1 : 0),
    finding_count: recorded.length,
    ...(declared === null ? {} : { class: declared }),
    ...(rejecting ? {} : { resolved_count: resolved.length }),
  };
}
