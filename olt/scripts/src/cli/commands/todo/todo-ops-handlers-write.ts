import {
  recordCompletedTasksBatch,
  resolveCompletedTasksLedgerPath,
  type CompletedTaskRecord,
} from "../../../mind/archival/completed/index.ts";
import {
  ingestFeedbackItem,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  sealFeedbackResolution,
  updateOrPruneFeedbackItems,
  type FeedbackItem,
  type FeedbackResolutionProof,
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
import type { TodoAddResult, TodoCleanResult, TodoSealResult } from "./todo-ops-types.ts";
import { parseCategory, parsePriority } from "./todo-ops-utils.ts";

export function todoAddCommand(flags: Flags, _context?: CommandContext): TodoAddResult {
  const title = textFlag(flags, "title", true)!.trim();
  const content = (
    textFlag(flags, "content", false) ??
    textFlag(flags, "description", false) ??
    ""
  ).trim();
  if (!content) {
    throw new Error("Missing required flag: content (or description)");
  }
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

export function todoSealCommand(flags: Flags, _context?: CommandContext): TodoSealResult {
  assertFlags(flags, [
    "authority-run",
    "actor",
    "id",
    "resolution",
    "note",
    "summary",
    "proof",
    "commit",
    "commit-sha",
    "test-path",
    "assertions",
    "runtime-ms",
    "queue-file",
    "queue-path",
    "require-commit-sha",
    "require-test-path",
  ]);
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
  assertFlags(flags, [
    "authority-run",
    "actor",
    "force",
    "dry-run",
    "queue-file",
    "queue-path",
    "archive-file",
  ]);
  const queuePath = textFlag(flags, "queue-file", false) ?? textFlag(flags, "queue-path", false);
  const archivePath = textFlag(flags, "archive-file", false);
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
