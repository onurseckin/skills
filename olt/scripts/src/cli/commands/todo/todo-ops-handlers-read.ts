import {
  drainPendingFeedbacks,
  getFeedbackStats,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  type FeedbackItem,
  type FeedbackStatus,
} from "../../../mind/feedback/queue/index.ts";
import { enforceLineLimit, formatTable, nextActionsBlock } from "../../formatters/index.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../../index.ts";
import type { TodoDrainResult, TodoListResult } from "./todo-ops-types.ts";
import { parseCategory, parsePriority } from "./todo-ops-utils.ts";

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

export function todoDrainCommand(flags: Flags, _context?: CommandContext): TodoDrainResult {
  const limit = integerFlag(flags, "limit", { minimum: 1 }) ?? 1;
  const markAsRaw = textFlag(flags, "mark-as", false);
  const categoryRaw = textFlag(flags, "category", false);
  const priorityRaw = textFlag(flags, "priority", false);
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);
  assertFlags(flags, [
    "authority-run",
    "actor",
    "limit",
    "mark-as",
    "category",
    "priority",
    "queue-file",
    "queue-path",
  ]);

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
