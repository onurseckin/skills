import {
  appendFeedbackItem,
  drainPendingFeedbacks,
  getFeedbackStats,
  readFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackPriority,
  type FeedbackStatus,
} from "../../mind/feedback-queue.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface FeedbackListResult {
  readonly markdown: string;
  readonly count: number;
  readonly stats: {
    readonly total: number;
    readonly pending: number;
    readonly admitted: number;
    readonly declined: number;
    readonly processed: number;
    readonly completed: number;
  };
  readonly items: readonly FeedbackItem[];
  readonly [key: string]: unknown;
}

export interface FeedbackIngestResult {
  readonly markdown: string;
  readonly item: FeedbackItem;
  readonly [key: string]: unknown;
}

export interface FeedbackDrainResult {
  readonly markdown: string;
  readonly drainedCount: number;
  readonly items: readonly FeedbackItem[];
  readonly [key: string]: unknown;
}

export function feedbackListCommand(flags: Flags, _context?: CommandContext): FeedbackListResult {
  const queuePath = textFlag(flags, "queue-file", false);
  const statusFilter = textFlag(flags, "status", false);
  const categoryFilter = textFlag(flags, "category", false);
  const limit = integerFlag(flags, "limit", { minimum: 1 }) ?? 20;

  const allItems = readFeedbackQueue(queuePath);
  const stats = getFeedbackStats(allItems);

  let filtered = allItems;
  if (statusFilter && statusFilter.trim()) {
    const s = statusFilter.trim().toUpperCase();
    filtered = filtered.filter((item) => item.status === s);
  }
  if (categoryFilter && categoryFilter.trim()) {
    const c = categoryFilter.trim().toUpperCase();
    filtered = filtered.filter((item) => item.category === c);
  }

  const items = filtered.slice(0, limit);

  const lines: string[] = [
    "### Feedback & To-Do Intake Queue",
    `- **Total Ingested Items**: ${stats.total}`,
    `- **Status Breakdown**: Pending: ${stats.pending} | Admitted: ${stats.admitted} | Processed: ${stats.processed} | Completed: ${stats.completed} | Declined: ${stats.declined}`,
    `- **Displaying**: ${items.length} items (limit: ${limit})`,
  ];

  if (items.length > 0) {
    lines.push("");
    lines.push("| ID | Priority | Status | Category | Title |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const item of items) {
      lines.push(
        `| \`${item.id}\` | ${item.priority} | ${item.status} | ${item.category} | ${item.title} |`,
      );
    }
  } else {
    lines.push("");
    lines.push("_No feedback items matching the current filter._");
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    count: items.length,
    stats,
    items,
  };
}

export function feedbackIngestCommand(
  flags: Flags,
  _context?: CommandContext,
): FeedbackIngestResult {
  const id = textFlag(flags, "id", true)!;
  const title = textFlag(flags, "title", true)!;
  const content = textFlag(flags, "content", true)!;
  const priorityRaw = textFlag(flags, "priority", false);
  const categoryRaw = textFlag(flags, "category", false);
  const queuePath = textFlag(flags, "queue-file", false);

  const item = appendFeedbackItem(
    {
      id: id.trim(),
      title: title.trim(),
      content: content.trim(),
      priority:
        priorityRaw !== undefined && priorityRaw.trim().length > 0
          ? (priorityRaw.trim().toUpperCase() as FeedbackPriority)
          : "CRITICAL_USER_FEEDBACK",
      category:
        categoryRaw !== undefined && categoryRaw.trim().length > 0
          ? (categoryRaw.trim().toUpperCase() as FeedbackCategory)
          : "GENERAL",
      status: "PENDING",
    },
    queuePath,
  );

  const lines: string[] = [
    `### Feedback Item Ingested: \`${item.id}\``,
    `- **Title**: ${item.title}`,
    `- **Priority**: ${item.priority}`,
    `- **Category**: ${item.category}`,
    `- **Status**: ${item.status}`,
    `- **Timestamp**: ${item.timestamp}`,
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    item,
  };
}

export function feedbackDrainCommand(flags: Flags, _context?: CommandContext): FeedbackDrainResult {
  const markAsRaw = textFlag(flags, "mark-as", false);
  const limit = integerFlag(flags, "limit", { minimum: 1 });
  const categoryRaw = textFlag(flags, "category", false);
  const queuePath = textFlag(flags, "queue-file", false);

  const markAs: FeedbackStatus =
    markAsRaw !== undefined && markAsRaw.trim().length > 0
      ? (markAsRaw.trim().toUpperCase() as FeedbackStatus)
      : "PROCESSED";
  const category = categoryRaw?.trim().toUpperCase() as FeedbackCategory | undefined;

  const drained = drainPendingFeedbacks(
    {
      markAs,
      ...(limit !== undefined ? { limit } : {}),
      ...(category !== undefined ? { category } : {}),
    },
    queuePath,
  );

  const lines: string[] = [
    `### Feedback Queue Drained`,
    `- **Items Drained**: ${drained.length}`,
    `- **Marked As**: ${markAs}`,
    `- **Category Filter**: ${category !== undefined ? category : "ALL"}`,
  ];

  if (drained.length > 0) {
    lines.push("");
    lines.push("| ID | Priority | Category | Title |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const item of drained) {
      lines.push(`| \`${item.id}\` | ${item.priority} | ${item.category} | ${item.title} |`);
    }
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    drainedCount: drained.length,
    items: drained,
  };
}
