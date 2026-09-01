import { resolveTaskQueuePath } from "../../../task/queue/index.ts";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { HarnessError } from "../../../core/errors/index.ts";
import type {
  FeedbackItem,
  FeedbackPriority,
  FeedbackStatus,
  AtomicAdmissionDispatchResult,
  AdmissionDispatchIntegrityReport,
} from "./types.ts";
import { resolveFeedbackQueuePath } from "./types.ts";
import { readFeedbackQueueStrict, readFeedbackQueue } from "./ingest.ts";
import { writeFeedbackQueue, withFeedbackQueueTransaction } from "./admission.ts";
import { updateFeedbackItem } from "./ops.ts";
import { sortFeedbackByPriority } from "./filter.ts";
export function admitAndDispatchFeedbackAtomically(
  idOrItem:
    | string
    | (Omit<FeedbackItem, "timestamp" | "status"> & {
        readonly timestamp?: string | undefined;
        readonly status?: FeedbackStatus | undefined;
      }),
  dispatcher: (item: FeedbackItem) => {
    readonly taskId: string;
    readonly autoEnqueued?: boolean | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
  customPath?: string,
): AtomicAdmissionDispatchResult {
  const existing = readFeedbackQueue(customPath);
  const nowIso = new Date().toISOString();

  let targetItem: FeedbackItem;
  let targetIndex = -1;

  if (typeof idOrItem === "string") {
    targetIndex = existing.findIndex((e) => e.id === idOrItem);
    if (targetIndex === -1) {
      throw new HarnessError(
        "INVALID_STATE",
        `Feedback item with id '${idOrItem}' not found in queue`,
      );
    }
    targetItem = existing[targetIndex]!;
  } else {
    targetIndex = existing.findIndex((e) => e.id === idOrItem.id);
    if (targetIndex !== -1) {
      targetItem = {
        ...existing[targetIndex]!,
        ...idOrItem,
        status: idOrItem.status ?? existing[targetIndex]!.status,
        timestamp: idOrItem.timestamp ?? existing[targetIndex]!.timestamp,
      };
    } else {
      const initialStatus: FeedbackStatus =
        idOrItem.status !== undefined ? idOrItem.status : "PENDING";
      targetItem = {
        ...idOrItem,
        status: initialStatus,
        timestamp: idOrItem.timestamp ?? nowIso,
      };
    }
  }

  const dispatchRes = dispatcher(targetItem);
  if (!dispatchRes.taskId || !dispatchRes.taskId.trim()) {
    throw new HarnessError(
      "INTEGRITY",
      "Atomic admission-to-dispatch failure: dispatcher did not return a valid taskId",
    );
  }

  const updatedMetadata: Record<string, unknown> = {
    ...targetItem.metadata,
    ...dispatchRes.metadata,
    dispatched_task_id: dispatchRes.taskId.trim(),
    atomic_dispatched_at: nowIso,
  };

  const admittedItem: FeedbackItem = {
    ...targetItem,
    status: "ADMITTED",
    processed_at: nowIso,
    metadata: updatedMetadata,
  };

  return withFeedbackQueueTransaction(customPath, (current) => {
    let index = -1;
    if (typeof idOrItem === "string") {
      index = current.findIndex((e) => e.id === idOrItem);
      if (index === -1) {
        throw new HarnessError(
          "INVALID_STATE",
          `Feedback item with id '${idOrItem}' not found in queue`,
        );
      }
    } else {
      index = current.findIndex((e) => e.id === idOrItem.id);
    }

    const updatedList = [...current];
    if (index !== -1) {
      updatedList[index] = admittedItem;
    } else {
      updatedList.push(admittedItem);
    }

    return {
      items: updatedList,
      result: {
        feedback_item: admittedItem,
        dispatched_task_id: dispatchRes.taskId.trim(),
        admitted_at: nowIso,
        auto_enqueued: dispatchRes.autoEnqueued ?? true,
      },
    };
  });
}

export function auditAdmissionDispatchIntegrity(
  options: {
    readonly feedbackPath?: string | undefined;
    readonly taskQueuePath?: string | undefined;
  } = {},
): AdmissionDispatchIntegrityReport {
  const feedbacks = readFeedbackQueue(options.feedbackPath);
  const admittedFeedbacks = feedbacks.filter((f) => f.status === "ADMITTED");

  const taskQueueFilePath = resolveTaskQueuePath(options.taskQueuePath);
  interface ParsedTaskInfo {
    readonly id: string;
    readonly status: string;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  }
  const taskItems: ParsedTaskInfo[] = [];

  if (existsSync(taskQueueFilePath)) {
    try {
      const raw = readFileSync(taskQueueFilePath, "utf8");
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed && typeof parsed["id"] === "string") {
            taskItems.push({
              id: parsed["id"],
              status: typeof parsed["status"] === "string" ? parsed["status"] : "PENDING",
              metadata:
                typeof parsed["metadata"] === "object" && parsed["metadata"] !== null
                  ? (parsed["metadata"] as Readonly<Record<string, unknown>>)
                  : undefined,
            });
          }
        } catch {}
      }
    } catch {}
  }

  const taskMap = new Map<string, ParsedTaskInfo>();
  const feedbackIdToTaskMap = new Map<string, ParsedTaskInfo>();
  for (const t of taskItems) {
    taskMap.set(t.id, t);
    const fbId = t.metadata?.["feedback_id"] ?? t.metadata?.["batched_feedback_ids"];
    if (typeof fbId === "string") {
      feedbackIdToTaskMap.set(fbId, t);
    }
  }

  const violations: string[] = [];
  const pausedAdmitted: FeedbackItem[] = [];
  let activeDispatchedCount = 0;

  for (const fb of admittedFeedbacks) {
    const dispatchedTaskId = fb.metadata?.["dispatched_task_id"];
    const matchedByMeta =
      typeof dispatchedTaskId === "string" ? taskMap.get(dispatchedTaskId) : undefined;
    const matchedByFbId = feedbackIdToTaskMap.get(fb.id);
    const matchedTask = matchedByMeta ?? matchedByFbId;

    if (!matchedTask) {
      violations.push(
        `Admitted feedback item '${fb.id}' (${fb.title}) is paused without an enqueued/dispatched task node.`,
      );
      pausedAdmitted.push(fb);
    } else {
      activeDispatchedCount++;
    }
  }

  return {
    is_compliant: violations.length === 0,
    total_feedback_items: feedbacks.length,
    admitted_feedback_count: admittedFeedbacks.length,
    paused_admitted_feedback_count: pausedAdmitted.length,
    paused_admitted_feedbacks: pausedAdmitted,
    active_dispatched_feedback_count: activeDispatchedCount,
    violations,
  };
}

export function reconcilePausedAdmittedFeedbacks(
  options: {
    readonly feedbackPath?: string | undefined;
    readonly taskQueuePath?: string | undefined;
    readonly resetToPending?: boolean | undefined;
  } = {},
): {
  readonly reconciled_count: number;
  readonly remediated_feedbacks: readonly FeedbackItem[];
} {
  const audit = auditAdmissionDispatchIntegrity(options);
  if (audit.paused_admitted_feedback_count === 0) {
    return {
      reconciled_count: 0,
      remediated_feedbacks: [],
    };
  }

  const pausedIds = new Set(audit.paused_admitted_feedbacks.map((f) => f.id));
  return withFeedbackQueueTransaction(options.feedbackPath, (existing) => {
    const remediated: FeedbackItem[] = [];
    const items = existing.map((item) => {
      if (!pausedIds.has(item.id)) return item;
      const updated: FeedbackItem = {
        ...item,
        status: options.resetToPending ? "PENDING" : "ADMITTED",
        processed_at: null,
      };
      remediated.push(updated);
      return updated;
    });
    return {
      items,
      result: { reconciled_count: remediated.length, remediated_feedbacks: remediated },
    };
  });
}

export function migrateFeedbackQueue(options: { sourcePath: string; targetPath?: string }): {
  migrated: boolean;
  count: number;
} {
  const target = resolveFeedbackQueuePath(options.targetPath);
  if (!existsSync(options.sourcePath) || options.sourcePath === target) {
    return { migrated: false, count: 0 };
  }
  const records = readFeedbackQueue(options.sourcePath);
  if (records.length === 0) {
    return { migrated: false, count: 0 };
  }
  return withFeedbackQueueTransaction(target, (existing) => {
    const map = new Map<string, FeedbackItem>();
    for (const item of existing) map.set(item.id, item);
    for (const item of records) map.set(item.id, item);
    return { items: Array.from(map.values()), result: { migrated: true, count: records.length } };
  });
}
