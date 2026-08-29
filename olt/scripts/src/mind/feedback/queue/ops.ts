import { HarnessError } from "../../../core/errors/index.ts";
import type {
  FeedbackCategory,
  FeedbackItem,
  FeedbackPriority,
  FeedbackResolutionProof,
  FeedbackStatus,
} from "./types.ts";
import { resolveFeedbackQueuePath } from "./types.ts";
import { validateFeedbackResolutionProof } from "./storage.ts";
import { verifyFeedbackEmpiricalSealing } from "./ingest.ts";
import { writeFeedbackQueue, withFeedbackQueueTransaction } from "./admission.ts";
export function clearFeedbackQueue(customPath?: string): void {
  withFeedbackQueueTransaction(customPath, () => ({ items: [], result: undefined }));
}

export function appendFeedbackItem(
  item: Omit<FeedbackItem, "timestamp"> & { timestamp?: string },
  customPath?: string,
): FeedbackItem {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    if (existing.some((entry) => entry.id === item.id))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Feedback item with id '${item.id}' already exists in the queue`,
      );
    const newItem: FeedbackItem = {
      ...item,
      timestamp: item.timestamp ?? new Date().toISOString(),
    };
    return { items: [...existing, newItem], result: newItem };
  });
}

/** Appends items atomically, skipping titles already present or duplicated in the supplied batch. */
export function appendFeedbackItemsDedupedByTitle(
  items: readonly (Omit<FeedbackItem, "timestamp"> & { readonly timestamp?: string | undefined })[],
  customPath?: string,
): readonly FeedbackItem[] {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const titles = new Set(existing.map((item) => item.title.trim().toLowerCase()));
    const ids = new Set(existing.map((item) => item.id));
    const appended: FeedbackItem[] = [];
    for (const input of items) {
      const title = input.title.trim().toLowerCase();
      if (titles.has(title)) continue;
      if (ids.has(input.id))
        throw new HarnessError(
          "INTEGRITY",
          `Feedback item with id '${input.id}' already exists in the queue`,
        );
      const item: FeedbackItem = {
        ...input,
        timestamp: input.timestamp ?? new Date().toISOString(),
      };
      titles.add(title);
      ids.add(item.id);
      appended.push(item);
    }
    return { items: [...existing, ...appended], result: appended };
  });
}

/** Predicate-scoped atomic update/prune primitive for callers that must avoid whole-ledger RMW. */
export function updateOrPruneFeedbackItems<T>(
  mutation: (item: FeedbackItem) => FeedbackItem | null,
  customPath?: string,
  result?: (items: readonly FeedbackItem[]) => T,
): T | readonly FeedbackItem[] {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const next = existing.flatMap((item) => {
      const updated = mutation(item);
      return updated === null ? [] : [updated];
    });
    return { items: next, result: result ? result(next) : next };
  });
}

export function ingestFeedbackItem(
  input: {
    readonly id?: string | undefined;
    readonly title: string;
    readonly content: string;
    readonly priority?: FeedbackPriority | undefined;
    readonly category?: FeedbackCategory | undefined;
    readonly candidate_id?: string | null | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
  customPath?: string,
): FeedbackItem {
  const generatedId = input.id ?? `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return appendFeedbackItem(
    {
      id: generatedId,
      title: input.title,
      content: input.content,
      priority: input.priority ?? "NORMAL",
      category: input.category ?? "GENERAL",
      status: "PENDING",
      candidate_id: input.candidate_id ?? null,
      metadata: input.metadata,
    },
    customPath,
  );
}

export function admitFeedbackToQueue(
  idOrItem:
    | string
    | (Omit<FeedbackItem, "timestamp" | "status"> & {
        readonly timestamp?: string | undefined;
        readonly status?: FeedbackStatus | undefined;
      }),
  customPath?: string,
): FeedbackItem {
  if (typeof idOrItem === "string") {
    return withFeedbackQueueTransaction(customPath, (existing) => {
      const index = existing.findIndex((entry) => entry.id === idOrItem);
      if (index === -1)
        throw new HarnessError(
          "INVALID_STATE",
          `Feedback item with id '${idOrItem}' not found in queue`,
        );
      const updatedItem = {
        ...existing[index]!,
        status: "ADMITTED" as const,
        processed_at: existing[index]!.processed_at ?? new Date().toISOString(),
      };
      const items = [...existing];
      items[index] = updatedItem;
      return { items, result: updatedItem };
    });
  }
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const index = existing.findIndex((entry) => entry.id === idOrItem.id);
    const now = new Date().toISOString();
    if (index !== -1) {
      const current = existing[index]!;
      const updatedItem: FeedbackItem = {
        ...current,
        ...idOrItem,
        timestamp: idOrItem.timestamp ?? current.timestamp,
        status: idOrItem.status ?? "ADMITTED",
        processed_at: current.processed_at ?? now,
      };
      const items = [...existing];
      items[index] = updatedItem;
      return { items, result: updatedItem };
    }
    const newItem: FeedbackItem = {
      ...idOrItem,
      status: idOrItem.status ?? "ADMITTED",
      timestamp: idOrItem.timestamp ?? now,
      processed_at: now,
    };
    return { items: [...existing, newItem], result: newItem };
  });
}

export function updateFeedbackItem(
  id: string,
  update: Partial<FeedbackItem>,
  customPath?: string,
): FeedbackItem {
  return withFeedbackQueueTransaction(customPath, (existing) => {
    const index = existing.findIndex((entry) => entry.id === id);
    if (index === -1)
      throw new HarnessError("INVALID_STATE", `Feedback item with id '${id}' not found in queue`);
    const current = existing[index]!;
    const updatedItem: FeedbackItem = {
      ...current,
      ...update,
      id: current.id,
      timestamp: current.timestamp,
    };
    const items = [...existing];
    items[index] = updatedItem;
    return { items, result: updatedItem };
  });
}

export function sealFeedbackResolution(
  idOrTaskId: string,
  proof: FeedbackResolutionProof,
  options?: {
    readonly customPath?: string | undefined;
    readonly requireCommitSha?: boolean | undefined;
    readonly requireTestPath?: boolean | undefined;
  },
): FeedbackItem {
  const validatedProof = validateFeedbackResolutionProof(proof, {
    requireCommitSha: options?.requireCommitSha,
    requireTestPath: options?.requireTestPath,
  });
  return withFeedbackQueueTransaction(options?.customPath, (existing) => {
    const index = existing.findIndex(
      (entry) => entry.id === idOrTaskId || entry.candidate_id === idOrTaskId,
    );
    if (index === -1)
      throw new HarnessError(
        "INVALID_STATE",
        `Feedback item matching id or candidate_id '${idOrTaskId}' not found in queue`,
      );
    const current = existing[index]!;
    const proofSummary =
      validatedProof.proof_summary ??
      validatedProof.test_assertion ??
      current.resolution_note ??
      `Empirically resolved by ${validatedProof.task_id}`;
    const updatedItem: FeedbackItem = {
      ...current,
      status: "COMPLETED",
      processed_at: validatedProof.resolved_at,
      resolution_note: proofSummary,
      resolution: validatedProof,
      ...(validatedProof.test_path !== undefined && validatedProof.test_path !== null
        ? { test_path: validatedProof.test_path }
        : current.test_path !== undefined
          ? { test_path: current.test_path }
          : {}),
      ...(validatedProof.assertions !== undefined && validatedProof.assertions !== null
        ? { assertions: validatedProof.assertions }
        : current.assertions !== undefined
          ? { assertions: current.assertions }
          : {}),
      ...(validatedProof.runtime_ms !== undefined && validatedProof.runtime_ms !== null
        ? { runtime_ms: validatedProof.runtime_ms }
        : current.runtime_ms !== undefined
          ? { runtime_ms: current.runtime_ms }
          : {}),
      ...(validatedProof.commit_sha !== undefined && validatedProof.commit_sha !== null
        ? { commit_sha: validatedProof.commit_sha }
        : current.commit_sha !== undefined
          ? { commit_sha: current.commit_sha }
          : {}),
    };
    const items = [...existing];
    items[index] = updatedItem;
    return { items, result: updatedItem };
  });
}
