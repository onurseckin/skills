import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  feedbackDrainCommand,
  feedbackIngestCommand,
  feedbackListCommand,
} from "../../../../../olt/scripts/src/cli/commands/feedback-ops.ts";

describe("feedback-ops CLI commands", () => {
  let testDir: string;
  let queueFile: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `feedback-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    queueFile = join(testDir, "feedback.jsonl");
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("feedbackIngestCommand ingests feedback with default and custom options", () => {
    // Default priority and category
    const res1 = feedbackIngestCommand({
      id: "fb-1",
      title: "Fix crash on startup",
      content: "Null pointer exception during init",
      "queue-file": queueFile,
    });
    expect(res1.item.id).toBe("fb-1");
    expect(res1.item.priority).toBe("CRITICAL_USER_FEEDBACK");
    expect(res1.item.category).toBe("GENERAL");
    expect(res1.item.status).toBe("PENDING");
    expect(res1.markdown).toContain("### Feedback Item Ingested: `fb-1`");
    expect(res1.markdown).toContain("Fix crash on startup");

    // Custom priority and category
    const res2 = feedbackIngestCommand({
      id: "fb-2",
      title: "Improve doc formatting",
      content: "Add code blocks",
      priority: "HIGH",
      category: "DOCUMENTATION",
      "queue-file": queueFile,
    });
    expect(res2.item.id).toBe("fb-2");
    expect(res2.item.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
    expect(res2.item.category).toBe("DOCUMENTATION");
    expect(res2.markdown).toContain("Improve doc formatting");
  });

  test("feedbackListCommand lists and filters feedback items", () => {
    // Empty list
    const emptyRes = feedbackListCommand({
      "queue-file": queueFile,
    });
    expect(emptyRes.count).toBe(0);
    expect(emptyRes.items).toHaveLength(0);
    expect(emptyRes.markdown).toContain("_No feedback items matching the current filter._");

    // Seed multiple items
    feedbackIngestCommand({
      id: "fb-1",
      title: "Bug 1",
      content: "Desc 1",
      priority: "CRITICAL",
      category: "REPAIR",
      "queue-file": queueFile,
    });
    feedbackIngestCommand({
      id: "fb-2",
      title: "Feature 2",
      content: "Desc 2",
      priority: "NORMAL",
      category: "ARCHITECTURE",
      "queue-file": queueFile,
    });
    feedbackIngestCommand({
      id: "fb-3",
      title: "Perf 3",
      content: "Desc 3",
      priority: "LOW",
      category: "SCALING",
      "queue-file": queueFile,
    });

    // Unfiltered listing
    const listRes = feedbackListCommand({
      "queue-file": queueFile,
      limit: 10,
    });
    expect(listRes.count).toBe(3);
    expect(listRes.items).toHaveLength(3);
    expect(listRes.stats.total).toBe(3);
    expect(listRes.stats.pending).toBe(3);
    expect(listRes.markdown).toContain("### Feedback & To-Do Intake Queue");
    expect(listRes.markdown).toContain("`fb-1`");
    expect(listRes.markdown).toContain("`fb-2`");
    expect(listRes.markdown).toContain("`fb-3`");

    // Filter by status
    const statusRes = feedbackListCommand({
      "queue-file": queueFile,
      status: "PENDING",
    });
    expect(statusRes.count).toBe(3);

    // Filter by non-existent status
    const closedRes = feedbackListCommand({
      "queue-file": queueFile,
      status: "COMPLETED",
    });
    expect(closedRes.count).toBe(0);

    // Filter by category
    const catRes = feedbackListCommand({
      "queue-file": queueFile,
      category: "REPAIR",
    });
    expect(catRes.count).toBe(1);
    expect(catRes.items[0]?.id).toBe("fb-1");

    // Limit check
    const limitRes = feedbackListCommand({
      "queue-file": queueFile,
      limit: 2,
    });
    expect(limitRes.count).toBe(2);
  });

  test("feedbackDrainCommand drains items with filters and mark-as status", () => {
    feedbackIngestCommand({
      id: "fb-1",
      title: "Task 1",
      content: "Desc 1",
      category: "ARCHITECTURE",
      "queue-file": queueFile,
    });
    feedbackIngestCommand({
      id: "fb-2",
      title: "Task 2",
      content: "Desc 2",
      category: "REPAIR",
      "queue-file": queueFile,
    });

    // Drain with category filter
    const drain1 = feedbackDrainCommand({
      category: "ARCHITECTURE",
      "mark-as": "ADMITTED",
      "queue-file": queueFile,
    });
    expect(drain1.drainedCount).toBe(1);
    expect(drain1.items[0]?.id).toBe("fb-1");
    expect(drain1.markdown).toContain("### Feedback Queue Drained");
    expect(drain1.markdown).toContain("`fb-1`");
    expect(drain1.markdown).toContain("- **Marked As**: ADMITTED");

    // Drain remaining with default mark-as (PROCESSED) and limit
    const drain2 = feedbackDrainCommand({
      limit: 5,
      "queue-file": queueFile,
    });
    expect(drain2.drainedCount).toBe(1);
    expect(drain2.items[0]?.id).toBe("fb-2");
    expect(drain2.markdown).toContain("- **Marked As**: PROCESSED");

    // Drain when empty
    const drain3 = feedbackDrainCommand({
      "queue-file": queueFile,
    });
    expect(drain3.drainedCount).toBe(0);
    expect(drain3.items).toHaveLength(0);
    expect(drain3.markdown).toContain("- **Items Drained**: 0");
  });
});
