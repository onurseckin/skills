import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  drainPendingFeedbacks,
  getFeedbackStats,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  updateFeedbackItem,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Feedback Queue Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-feedback-queue");
  const queueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  it("resolves feedback queue path correctly", () => {
    const explicit = resolveFeedbackQueuePath("/custom/path/queue.jsonl");
    expect(explicit).toBe("/custom/path/queue.jsonl");

    const resolved = resolveFeedbackQueuePath();
    expect(typeof resolved).toBe("string");
    expect(resolved.endsWith(".capsules/FEEDBACK_QUEUE.jsonl")).toBe(true);
  });

  it("returns empty array when queue file does not exist", () => {
    setup();
    const items = readFeedbackQueue(queueFile);
    expect(items).toEqual([]);
    teardown();
  });

  it("appends and reads feedback items with priority sorting", () => {
    setup();
    const item1 = appendFeedbackItem(
      {
        id: "fb-low",
        title: "Low Priority Item",
        content: "Some low priority content",
        priority: "LOW",
        category: "DOCUMENTATION",
        status: "PENDING",
      },
      queueFile,
    );

    const item2 = appendFeedbackItem(
      {
        id: "fb-critical",
        title: "Critical Item",
        content: "Critical fix required",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
        status: "PENDING",
      },
      queueFile,
    );

    const read = readFeedbackQueue(queueFile);
    expect(read).toHaveLength(2);
    // Critical priority must be first
    expect(read[0]?.id).toBe("fb-critical");
    expect(read[1]?.id).toBe("fb-low");

    teardown();
  });

  it("throws when appending duplicate feedback ID", () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-dup",
        title: "First",
        content: "Content",
        priority: "NORMAL",
        category: "GENERAL",
        status: "PENDING",
      },
      queueFile,
    );

    expect(() => {
      appendFeedbackItem(
        {
          id: "fb-dup",
          title: "Second",
          content: "Content",
          priority: "NORMAL",
          category: "GENERAL",
          status: "PENDING",
        },
        queueFile,
      );
    }).toThrow("already exists");

    teardown();
  });

  it("updates feedback item status and metadata", () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-1",
        title: "Initial Title",
        content: "Content",
        priority: "NORMAL",
        category: "ARCHITECTURE",
        status: "PENDING",
      },
      queueFile,
    );

    const updated = updateFeedbackItem(
      "fb-1",
      {
        status: "ADMITTED",
        candidate_id: "cand-1",
        resolution_note: "Admitted into wave 1",
      },
      queueFile,
    );

    expect(updated.status).toBe("ADMITTED");
    expect(updated.candidate_id).toBe("cand-1");
    expect(updated.resolution_note).toBe("Admitted into wave 1");

    const read = readFeedbackQueue(queueFile);
    expect(read[0]?.status).toBe("ADMITTED");

    teardown();
  });

  it("drains pending feedbacks with limits and category filter", () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-doc",
        title: "Doc task",
        content: "Fix doc",
        priority: "NORMAL",
        category: "DOCUMENTATION",
        status: "PENDING",
      },
      queueFile,
    );

    appendFeedbackItem(
      {
        id: "fb-core",
        title: "Core task",
        content: "Fix core",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "CORE_ENGINE",
        status: "PENDING",
      },
      queueFile,
    );

    const drainedDoc = drainPendingFeedbacks({ category: "DOCUMENTATION" }, queueFile);
    expect(drainedDoc).toHaveLength(1);
    expect(drainedDoc[0]?.id).toBe("fb-doc");
    expect(drainedDoc[0]?.status).toBe("PROCESSED");

    const remaining = readFeedbackQueue(queueFile);
    const core = remaining.find((i) => i.id === "fb-core");
    expect(core?.status).toBe("PENDING");

    const drainedAll = drainPendingFeedbacks({ markAs: "ADMITTED" }, queueFile);
    expect(drainedAll).toHaveLength(1);
    expect(drainedAll[0]?.id).toBe("fb-core");
    expect(drainedAll[0]?.status).toBe("ADMITTED");

    teardown();
  });

  it("calculates accurate queue stats", () => {
    const items: FeedbackItem[] = [
      {
        id: "1",
        timestamp: "T",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "1",
        content: "1",
      },
      {
        id: "2",
        timestamp: "T",
        priority: "NORMAL",
        status: "ADMITTED",
        category: "GENERAL",
        title: "2",
        content: "2",
      },
      {
        id: "3",
        timestamp: "T",
        priority: "NORMAL",
        status: "DECLINED",
        category: "GENERAL",
        title: "3",
        content: "3",
      },
      {
        id: "4",
        timestamp: "T",
        priority: "NORMAL",
        status: "PROCESSED",
        category: "GENERAL",
        title: "4",
        content: "4",
      },
      {
        id: "5",
        timestamp: "T",
        priority: "NORMAL",
        status: "COMPLETED",
        category: "GENERAL",
        title: "5",
        content: "5",
      },
    ];

    const stats = getFeedbackStats(items);
    expect(stats.total).toBe(5);
    expect(stats.pending).toBe(1);
    expect(stats.admitted).toBe(1);
    expect(stats.declined).toBe(1);
    expect(stats.processed).toBe(1);
    expect(stats.completed).toBe(1);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies feedback queue files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/feedback-ops.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/feedback-queue.test.ts",
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck", "eslint" + "-disable", "oxlint" + "-disable"].join("|"),
    );

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
