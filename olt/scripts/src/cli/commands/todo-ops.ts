import {
  recordCompletedTasksBatch,
  resolveCompletedTasksLedgerPath,
  type CompletedTaskRecord,
} from "../../mind/completed-tasks.ts";
import {
  drainPendingFeedbacks,
  getFeedbackStats,
  ingestFeedbackItem,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  sealFeedbackResolution,
  updateOrPruneFeedbackItems,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPriority,
  type FeedbackQueueStats,
  type FeedbackResolutionProof,
  type FeedbackStatus,
} from "../../mind/feedback-queue.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { nextActionsBlock } from "../formatters/next-actions.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface TodoListResult {
  readonly markdown: string;
  readonly count: number;
  readonly total: number;
  readonly filteredCount: number;
  readonly stats: FeedbackQueueStats;
  readonly items: readonly FeedbackItem[];
  readonly [key: string]: unknown;
}

export interface TodoAddResult {
  readonly markdown: string;
  readonly item: FeedbackItem;
  readonly [key: string]: unknown;
}

export interface TodoDrainResult {
  readonly markdown: string;
  readonly drainedCount: number;
  readonly items: readonly FeedbackItem[];
  readonly item?: FeedbackItem | undefined;
  readonly [key: string]: unknown;
}

export interface TodoSealResult {
  readonly markdown: string;
  readonly item: FeedbackItem;
  readonly sealed: boolean;
  readonly [key: string]: unknown;
}

export interface TodoCleanResult {
  readonly markdown: string;
  readonly cleanedCount: number;
  readonly remainingCount: number;
  readonly archived: readonly CompletedTaskRecord[];
  readonly dryRun: boolean;
  readonly [key: string]: unknown;
}

function parsePriority(val: string | undefined): FeedbackPriority {
  if (!val) return "NORMAL";
  const upper = val.trim().toUpperCase();
  if (upper === "CRITICAL_USER_FEEDBACK" || upper === "CRITICAL") return "CRITICAL_USER_FEEDBACK";
  if (upper === "HIGH_ARCHITECTURAL_FEATURE" || upper === "HIGH")
    return "HIGH_ARCHITECTURAL_FEATURE";
  if (upper === "USER_DIRECTIVE" || upper === "DIRECTIVE") return "USER_DIRECTIVE";
  if (upper === "NORMAL" || upper === "MEDIUM") return "NORMAL";
  if (upper === "LOW") return "LOW";
  return "NORMAL";
}

function parseCategory(val: string | undefined): FeedbackCategory {
  if (!val) return "GENERAL";
  const upper = val.trim().toUpperCase();
  if (upper === "DOCUMENTATION") return "DOCUMENTATION";
  if (upper === "AGENT_CONTRACTS") return "AGENT_CONTRACTS";
  if (upper === "CLI_TOOLING") return "CLI_TOOLING";
  if (upper === "WATCHDOG") return "WATCHDOG";
  if (upper === "SCALING") return "SCALING";
  if (upper === "ARCHITECTURE") return "ARCHITECTURE";
  if (upper === "CORE_ENGINE") return "CORE_ENGINE";
  if (upper === "REPAIR") return "REPAIR";
  return "GENERAL";
}

export function todoListCommand(flags: Flags, _context?: CommandContext): TodoListResult {
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);
  const statusFilter = textFlag(flags, "status", false);
  const categoryFilter = textFlag(flags, "category", false);
  const priorityFilter = textFlag(flags, "priority", false);
  const isAll = boolFlag(flags, "all");
  const limit = isAll ? undefined : (integerFlag(flags, "limit", { minimum: 1 }) ?? 20);

  const resolvedPath = resolveFeedbackQueuePath(queuePath);
  const allItems = readFeedbackQueue(resolvedPath);
  const stats = getFeedbackStats(allItems);

  let filtered = allItems;
  if (statusFilter && statusFilter.trim()) {
    const s = statusFilter.trim().toUpperCase();
    filtered = filtered.filter((item) => item.status.toUpperCase() === s);
  }
  if (categoryFilter && categoryFilter.trim()) {
    const c = categoryFilter.trim().toUpperCase();
    filtered = filtered.filter((item) => item.category.toUpperCase() === c);
  }
  if (priorityFilter && priorityFilter.trim()) {
    const p = priorityFilter.trim().toUpperCase();
    filtered = filtered.filter((item) => item.priority.toUpperCase() === p);
  }

  const displayItems = limit !== undefined ? filtered.slice(0, limit) : filtered;

  const lines: string[] = [
    "### Mind Queue / To-Do Intake",
    `- **Total Items**: ${stats.total}`,
    `- **Status**: Pending: ${stats.pending} | Admitted: ${stats.admitted} | Processed: ${stats.processed} | Completed: ${stats.completed} | Declined: ${stats.declined}`,
    `- **Filtered**: Showing ${displayItems.length} of ${filtered.length} matching items${
      isAll ? " (all)" : limit !== undefined ? ` (limit: ${limit})` : ""
    }`,
  ];

  if (displayItems.length > 0) {
    lines.push("");
    const tableRows = displayItems.map((item) => [
      `\`${item.id}\``,
      item.priority,
      item.status,
      item.category,
      item.title.length > 40 ? `${item.title.slice(0, 37)}...` : item.title,
    ]);
    lines.push(...formatTable(["ID", "Priority", "Status", "Category", "Title"], tableRows));
  } else {
    lines.push("");
    lines.push("_No items matching the current filter._");
  }

  lines.push(
    ...nextActionsBlock([
      {
        command: "bun harness.ts todo:add --title '<TITLE>' --content '<CONTENT>'",
        role: "Mind",
        description: "Ingest new item into queue",
      },
      {
        command: "bun harness.ts todo:drain",
        role: "Mind",
        description: "Drain next item from FIFO queue",
      },
    ]),
  );

  const markdown = isAll ? lines.join("\n") : enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    count: displayItems.length,
    total: allItems.length,
    filteredCount: filtered.length,
    stats,
    items: displayItems,
  };
}

export function todoAddCommand(flags: Flags, _context?: CommandContext): TodoAddResult {
  const title = textFlag(flags, "title", true)!.trim();
  const content = (textFlag(flags, "content", false) ??
    textFlag(flags, "description", false) ??
    textFlag(flags, "content", true))!.trim();
  const id = textFlag(flags, "id", false)?.trim();
  const priorityRaw = textFlag(flags, "priority", false)?.trim();
  const categoryRaw = textFlag(flags, "category", false)?.trim();
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);

  const priority = parsePriority(priorityRaw);
  const category = parseCategory(categoryRaw);
  const resolvedPath = queuePath ? resolveFeedbackQueuePath(queuePath) : undefined;

  const item = ingestFeedbackItem(
    {
      ...(id ? { id } : {}),
      title,
      content,
      priority,
      category,
    },
    resolvedPath,
  );

  const lines: string[] = [
    `### Mind Queue Item Added: \`${item.id}\``,
    `- **Title**: ${item.title}`,
    `- **Priority**: ${item.priority}`,
    `- **Category**: ${item.category}`,
    `- **Status**: ${item.status}`,
    `- **Timestamp**: \`${item.timestamp}\``,
    ...nextActionsBlock([
      {
        command: "bun harness.ts todo:drain",
        role: "Mind",
        description: "Drain next item from FIFO queue",
      },
      {
        command: "bun harness.ts todo:list",
        role: "Coordinator",
        description: "Inspect queue status",
      },
    ]),
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    item,
  };
}

export function todoDrainCommand(flags: Flags, _context?: CommandContext): TodoDrainResult {
  const limit = integerFlag(flags, "limit", { minimum: 1 }) ?? 1;
  const markAsRaw = textFlag(flags, "mark-as", false);
  const categoryRaw = textFlag(flags, "category", false);
  const priorityRaw = textFlag(flags, "priority", false);
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);

  const markAs: FeedbackStatus =
    markAsRaw && markAsRaw.trim()
      ? (markAsRaw.trim().toUpperCase() as FeedbackStatus)
      : "PROCESSED";
  const category = categoryRaw ? parseCategory(categoryRaw) : undefined;
  const priority = priorityRaw ? parsePriority(priorityRaw) : undefined;
  const resolvedPath = queuePath ? resolveFeedbackQueuePath(queuePath) : undefined;

  const filter =
    priority !== undefined ? (item: FeedbackItem) => item.priority === priority : undefined;

  const drained = drainPendingFeedbacks(
    {
      markAs,
      limit,
      ...(category !== undefined ? { category } : {}),
      ...(filter !== undefined ? { filter } : {}),
    },
    resolvedPath,
  );

  const lines: string[] = [];
  if (drained.length === 0) {
    lines.push("### Mind Queue Drain: Empty");
    lines.push("- **Status**: No pending items available to drain in queue.");
    lines.push(
      ...nextActionsBlock([
        {
          command: "bun harness.ts todo:add --title '<TITLE>' --content '<CONTENT>'",
          role: "Mind",
          description: "Ingest new item into queue",
        },
      ]),
    );
  } else {
    lines.push(`### Mind Queue Drained: ${drained.length} item(s)`);
    lines.push(`- **Marked As**: \`${markAs}\``);
    if (category !== undefined) lines.push(`- **Category Filter**: ${category}`);
    if (priority !== undefined) lines.push(`- **Priority Filter**: ${priority}`);
    lines.push("");
    const tableRows = drained.map((item) => [
      `\`${item.id}\``,
      item.priority,
      item.category,
      item.title.length > 40 ? `${item.title.slice(0, 37)}...` : item.title,
    ]);
    lines.push(...formatTable(["ID", "Priority", "Category", "Title"], tableRows));
    const firstId = drained[0]!.id;
    lines.push(
      ...nextActionsBlock([
        {
          command: `bun harness.ts todo:seal --id ${firstId} --resolution '<NOTE>'`,
          role: "Implementer",
          description: "Seal item resolution once work completes",
        },
        {
          command: "bun harness.ts todo:list",
          role: "Coordinator",
          description: "View remaining queue items",
        },
      ]),
    );
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    drainedCount: drained.length,
    items: drained,
    item: drained[0],
  };
}

export function todoSealCommand(flags: Flags, _context?: CommandContext): TodoSealResult {
  const id = textFlag(flags, "id", true)!.trim();
  const resolution = (textFlag(flags, "resolution", false) ??
    textFlag(flags, "note", false) ??
    textFlag(flags, "summary", false) ??
    textFlag(flags, "resolution", true))!.trim();
  const commitSha =
    textFlag(flags, "commit", false)?.trim() ?? textFlag(flags, "commit-sha", false)?.trim();
  const testPath = textFlag(flags, "test-path", false)?.trim();
  const assertions =
    integerFlag(flags, "assertions", { minimum: 0 }) ??
    textFlag(flags, "assertions", false)?.trim();
  const runtimeMs = integerFlag(flags, "runtime-ms", { minimum: 0 });
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);
  const requireCommitSha = boolFlag(flags, "require-commit-sha");
  const requireTestPath = boolFlag(flags, "require-test-path");

  const proof: FeedbackResolutionProof = {
    task_id: id,
    resolved_at: new Date().toISOString(),
    proof_summary: resolution,
    ...(commitSha ? { commit_sha: commitSha } : {}),
    ...(testPath ? { test_path: testPath } : {}),
    ...(assertions !== undefined ? { assertions } : {}),
    ...(runtimeMs !== undefined ? { runtime_ms: runtimeMs } : {}),
  };

  const sealed = sealFeedbackResolution(id, proof, {
    customPath: queuePath ? resolveFeedbackQueuePath(queuePath) : undefined,
    requireCommitSha,
    requireTestPath,
  });

  const lines: string[] = [
    `### Mind Queue Item Sealed: \`${sealed.id}\``,
    `- **Status**: \`${sealed.status}\``,
    `- **Title**: ${sealed.title}`,
    `- **Resolution**: ${sealed.resolution_note ?? resolution}`,
    `- **Resolved At**: \`${sealed.processed_at ?? sealed.resolution?.resolved_at}\``,
    ...(sealed.commit_sha ? [`- **Commit SHA**: \`${sealed.commit_sha}\``] : []),
    ...(sealed.test_path ? [`- **Test Path**: \`${sealed.test_path}\``] : []),
    ...nextActionsBlock([
      {
        command: "bun harness.ts todo:clean",
        role: "Mind",
        description: "Prune sealed items into completed archive ledger",
      },
      {
        command: "bun harness.ts todo:list",
        role: "Coordinator",
        description: "Inspect queue status",
      },
    ]),
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    item: sealed,
    sealed: true,
  };
}

export function todoCleanCommand(flags: Flags, _context?: CommandContext): TodoCleanResult {
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);
  const archivePath =
    textFlag(flags, "archive-file", false) ?? textFlag(flags, "completed-file", false);
  const dryRun = boolFlag(flags, "dry-run");

  const resolvedQueuePath = resolveFeedbackQueuePath(queuePath);
  const resolvedArchivePath = resolveCompletedTasksLedgerPath(archivePath);

  const allItems = readFeedbackQueue(resolvedQueuePath);
  const isCompletedOrResolved = (item: FeedbackItem) =>
    item.status === "COMPLETED" ||
    item.status === "DECLINED" ||
    (item.resolution !== undefined && item.resolution !== null);

  const toPrune = allItems.filter(isCompletedOrResolved);
  const remaining = allItems.filter((item) => !isCompletedOrResolved(item));

  const archivedRecords: CompletedTaskRecord[] = toPrune.map((item) => ({
    id: item.id,
    source: "feedback_queue",
    title: item.title,
    status: item.status === "DECLINED" ? "RESOLVED" : "COMPLETED",
    proof_summary:
      item.resolution_note ?? item.resolution?.proof_summary ?? `Cleaned item ${item.id}`,
    completed_at: item.processed_at ?? item.resolution?.resolved_at ?? new Date().toISOString(),
    ...(item.candidate_id ? { generation_id: item.candidate_id } : {}),
    ...((item.commit_sha ?? item.resolution?.commit_sha)
      ? { commit_sha: item.commit_sha ?? item.resolution?.commit_sha }
      : {}),
    ...(item.category ? { category: item.category } : {}),
    ...((item.test_path ?? item.resolution?.test_path)
      ? { test_path: item.test_path ?? item.resolution?.test_path }
      : {}),
    ...((item.assertions ?? item.resolution?.assertions !== undefined)
      ? { assertions: item.assertions ?? item.resolution?.assertions }
      : {}),
    ...((item.runtime_ms ?? item.resolution?.runtime_ms !== undefined)
      ? { runtime_ms: item.runtime_ms ?? item.resolution?.runtime_ms }
      : {}),
    ...(item.resolution ? { resolution: item.resolution } : {}),
    ...(item.metadata ? { metadata: item.metadata } : {}),
  }));

  if (!dryRun && toPrune.length > 0) {
    recordCompletedTasksBatch(archivedRecords, { customPath: resolvedArchivePath });
    const pruneIds = new Set(toPrune.map((item) => item.id));
    updateOrPruneFeedbackItems(
      (item) => (pruneIds.has(item.id) && isCompletedOrResolved(item) ? null : item),
      resolvedQueuePath,
    );
  }

  const lines: string[] = [
    "### Mind Queue Cleaned",
    `- **Pruned / Archived**: ${toPrune.length} items`,
    `- **Remaining Active**: ${remaining.length} items`,
    `- **Queue File**: \`${resolvedQueuePath}\``,
    `- **Archive Ledger**: \`${resolvedArchivePath}\``,
    `- **Mode**: ${dryRun ? "DRY RUN (no changes written)" : "COMMITTED"}`,
  ];

  if (toPrune.length > 0) {
    lines.push("");
    lines.push("#### Archived Items:");
    const tableRows = toPrune.map((item) => [
      `\`${item.id}\``,
      item.status,
      item.category,
      item.title.length > 35 ? `${item.title.slice(0, 32)}...` : item.title,
    ]);
    lines.push(...formatTable(["ID", "Status", "Category", "Title"], tableRows));
  }

  lines.push(
    ...nextActionsBlock([
      {
        command: "bun harness.ts todo:list",
        role: "Coordinator",
        description: "Inspect remaining queue items",
      },
      {
        command: "bun harness.ts mind:wake",
        role: "Mind",
        description: "Wake substrate loop",
      },
    ]),
  );

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    cleanedCount: toPrune.length,
    remainingCount: remaining.length,
    archived: archivedRecords,
    dryRun,
  };
}

export const mindQueueListCommand = todoListCommand;
export const mindQueueAddCommand = todoAddCommand;
export const mindQueueDrainCommand = todoDrainCommand;
export const mindQueueSealCommand = todoSealCommand;
export const mindQueueCleanCommand = todoCleanCommand;
