import { HarnessError } from "../../../core/errors/index.ts";
import type {
  BackpropagationRecord,
  FeedbackCategory,
  FeedbackItem,
  FeedbackPriority,
  FeedbackQueueStats,
  FeedbackResolutionProof,
  FeedbackStatus,
} from "./types.ts";
import { PRIORITY_ORDER, resolveFeedbackQueuePath } from "./types.ts";
import { withFeedbackQueueTransaction } from "./admission.ts";
import { appendFeedbackItem } from "./ops.ts";
import { validateFeedbackResolutionProof } from "./storage.ts";
export function backpropagateFeedbackResolution(
  records: readonly BackpropagationRecord[],
  customPath?: string,
): FeedbackItem[] {
  if (records.length === 0) {
    return [];
  }
  const taskMap = new Map<string, BackpropagationRecord>();
  for (const r of records) {
    taskMap.set(r.id, r);
  }

  return withFeedbackQueueTransaction(customPath, (existing) => {
    const updatedItems: FeedbackItem[] = [];
    const nextList: FeedbackItem[] = [];
    for (const item of existing) {
      const matchedRecord =
        taskMap.get(item.id) ?? (item.candidate_id ? taskMap.get(item.candidate_id) : undefined);
      if (matchedRecord) {
        const resolvedAt = matchedRecord.completed_at || new Date().toISOString();
        const testPath =
          matchedRecord.test_path ??
          (matchedRecord.metadata?.["test_path"] as string | undefined) ??
          item.test_path;
        const assertions =
          matchedRecord.assertions ??
          (matchedRecord.metadata?.["assertions"] as
            | number
            | string
            | readonly string[]
            | undefined) ??
          (matchedRecord.metadata?.["test_assertions"] as
            | number
            | string
            | readonly string[]
            | undefined) ??
          item.assertions;
        const runtimeMs =
          matchedRecord.runtime_ms ??
          (matchedRecord.metadata?.["runtime_ms"] as number | string | undefined) ??
          (matchedRecord.metadata?.["runtime"] as number | string | undefined) ??
          item.runtime_ms;
        const commitSha =
          matchedRecord.commit_sha ??
          (matchedRecord.metadata?.["commit_sha"] as string | undefined) ??
          item.commit_sha;
        const proofSummary =
          matchedRecord.proof_summary ??
          item.resolution_note ??
          `Resolved by task ${matchedRecord.id}`;

        let proof: FeedbackResolutionProof;
        if (matchedRecord.resolution) {
          proof = validateFeedbackResolutionProof({
            ...matchedRecord.resolution,
            task_id: matchedRecord.resolution.task_id || matchedRecord.id,
            resolved_at: matchedRecord.resolution.resolved_at || resolvedAt,
          });
        } else {
          proof = {
            task_id: matchedRecord.id,
            resolved_at: resolvedAt,
            ...(testPath ? { test_path: testPath } : {}),
            ...(assertions !== undefined && assertions !== null ? { assertions } : {}),
            ...(runtimeMs !== undefined && runtimeMs !== null ? { runtime_ms: runtimeMs } : {}),
            ...(commitSha ? { commit_sha: commitSha } : {}),
            ...(proofSummary ? { proof_summary: proofSummary, test_assertion: proofSummary } : {}),
          };
        }

        const updated: FeedbackItem = {
          ...item,
          status: "COMPLETED",
          processed_at: resolvedAt,
          resolution_note: proofSummary,
          resolution: proof,
          ...(testPath !== undefined && testPath !== null ? { test_path: testPath } : {}),
          ...(assertions !== undefined && assertions !== null ? { assertions } : {}),
          ...(runtimeMs !== undefined && runtimeMs !== null ? { runtime_ms: runtimeMs } : {}),
          ...(commitSha !== undefined && commitSha !== null ? { commit_sha: commitSha } : {}),
        };

        updatedItems.push(updated);
        nextList.push(updated);
      } else {
        nextList.push(item);
      }
    }
    return { items: nextList, result: updatedItems };
  });
}

export function drainPendingFeedbacks(
  options: {
    readonly markAs?: FeedbackStatus | undefined;
    readonly limit?: number | undefined;
    readonly category?: FeedbackCategory | undefined;
    readonly filter?: ((item: FeedbackItem) => boolean) | undefined;
  } = {},
  customPath?: string,
): FeedbackItem[] {
  const markAs = options.markAs !== undefined ? options.markAs : "PROCESSED";
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const nowIso = new Date().toISOString();

  return withFeedbackQueueTransaction(customPath, (existing) => {
    const selected: FeedbackItem[] = [];
    const updatedList: FeedbackItem[] = [];
    for (const item of existing) {
      const matchesCategory = !options.category || item.category === options.category;
      const matchesCustom = !options.filter || options.filter(item);
      if (
        item.status === "PENDING" &&
        matchesCategory &&
        matchesCustom &&
        selected.length < limit
      ) {
        const processed: FeedbackItem = {
          ...item,
          status: markAs,
          processed_at: nowIso,
        };
        selected.push(processed);
        updatedList.push(processed);
      } else {
        updatedList.push(item);
      }
    }
    return { items: updatedList, result: selected };
  });
}

export function compareFeedbackPriority(
  a: FeedbackItem | FeedbackPriority,
  b: FeedbackItem | FeedbackPriority,
): number {
  const priorityA = typeof a === "string" ? a : a.priority;
  const priorityB = typeof b === "string" ? b : b.priority;
  const rankA = PRIORITY_ORDER[priorityA] ?? 99;
  const rankB = PRIORITY_ORDER[priorityB] ?? 99;
  if (rankA !== rankB) {
    return rankA - rankB;
  }
  if (typeof a !== "string" && typeof b !== "string") {
    return a.timestamp.localeCompare(b.timestamp);
  }
  return 0;
}

export function sortFeedbackByPriority(items: readonly FeedbackItem[]): FeedbackItem[] {
  return [...items].sort((a, b) => compareFeedbackPriority(a, b));
}

export function getFeedbackStats(items: readonly FeedbackItem[]): FeedbackQueueStats {
  let pending = 0;
  let admitted = 0;
  let declined = 0;
  let processed = 0;
  let completed = 0;

  for (const item of items) {
    switch (item.status) {
      case "PENDING":
        pending += 1;
        break;
      case "ADMITTED":
        admitted += 1;
        break;
      case "DECLINED":
        declined += 1;
        break;
      case "PROCESSED":
        processed += 1;
        break;
      case "COMPLETED":
        completed += 1;
        break;
    }
  }

  return {
    total: items.length,
    pending,
    admitted,
    declined,
    processed,
    completed,
  };
}
