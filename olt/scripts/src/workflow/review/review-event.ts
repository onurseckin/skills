import type { JsonObject } from "../../core/contracts/index.ts";
import type { Finding } from "../../core/contracts/index.ts";
import type { TaskRecord } from "../types.ts";
import { findingClassOf, type FindingClass } from "./finding-class.ts";

export interface ReviewRecordedPayload extends JsonObject {
  task_id: string;
  verdict: "pass" | "reject";
  round: number;
  finding_count: number;
  class?: FindingClass;
  resolved_count?: number;
}

export type ThinReviewRecordedPayload = { task_id: string };

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

function sharedClass(findings: readonly JsonObject[]): FindingClass | null {
  if (findings.length === 0) return null;
  const declared = findings.map((finding) => findingClassOf(finding as Finding));
  const [first] = declared;
  if (first === undefined || first === null) return null;
  return declared.every((entry) => entry === first) ? first : null;
}

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
