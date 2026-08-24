import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  backpropagateFeedbackResolution,
  drainPendingFeedbacks,
  getFeedbackStats,
  migrateFeedbackQueue,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  resolveCanonicalFeedbackQueuePath,
  TODO_FEEDBACK_FILE,
  CANONICAL_FEEDBACK_FILE,
  sealFeedbackResolution,
  updateFeedbackItem,
  validateFeedbackResolutionProof,
  verifyFeedbackEmpiricalSealing,
  writeFeedbackQueue,
  type FeedbackItem,
  type FeedbackResolutionProof,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
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
    expect(resolved.endsWith("backlog.jsonl")).toBe(true);
  });

  it("resolves canonical feedback queue paths with todo and mind layout", () => {
    const canonical = resolveCanonicalFeedbackQueuePath("/tmp/repo");
    expect(canonical).toBe("/tmp/repo/.olt/backlog.jsonl");

    const todo = resolveCanonicalFeedbackQueuePath("/tmp/repo", true);
    expect(todo).toBe("/tmp/repo/.olt/backlog.jsonl");
  });

  it("migrates feedback queue from legacy path to canonical path", () => {
    const legacyPath = join(testDir, "legacy-FEEDBACK_QUEUE.jsonl");
    const canonicalPath = join(testDir, "canonical-feedback-queue.jsonl");

    const sampleItem: FeedbackItem = {
      id: "fb-migrated-01",
      timestamp: "2026-08-22T00:00:00.000Z",
      priority: "CRITICAL_USER_FEEDBACK",
      status: "PENDING",
      category: "CORE_ENGINE",
      title: "Migrated Feedback",
      content: "Testing migration",
    };
    writeFeedbackQueue([sampleItem], legacyPath);

    const migRes = migrateFeedbackQueue({
      sourcePath: legacyPath,
      targetPath: canonicalPath,
    });
    expect(migRes.migrated).toBe(true);
    expect(migRes.count).toBe(1);

    const canonicalItems = readFeedbackQueue(canonicalPath);
    expect(canonicalItems).toHaveLength(1);
    expect(canonicalItems[0]?.id).toBe("fb-migrated-01");
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

  it("validates feedback resolution proofs and empirical constraints", () => {
    expect(() => validateFeedbackResolutionProof(null)).toThrow("must be an object");
    expect(() => validateFeedbackResolutionProof({ task_id: "" })).toThrow("non-empty task_id");
    expect(() =>
      validateFeedbackResolutionProof({ task_id: "t1", resolved_at: "not-a-date" }),
    ).toThrow("not a valid ISO date timestamp");

    expect(() =>
      validateFeedbackResolutionProof(
        { task_id: "t1", resolved_at: "2026-08-22T00:00:00.000Z", commit_sha: "123" },
        { requireCommitSha: true },
      ),
    ).toThrow("valid commit_sha");

    expect(() =>
      validateFeedbackResolutionProof(
        { task_id: "t1", resolved_at: "2026-08-22T00:00:00.000Z", test_path: "a" },
        { requireTestPath: true },
      ),
    ).toThrow("valid test_path");

    const validProof = validateFeedbackResolutionProof({
      task_id: "t1",
      test_path: "tests/unit/example.test.ts",
      test_assertion: "expect(true).toBe(true)",
      assertions: ["assertion1", "assertion2"],
      runtime_ms: 125,
      commit_sha: "abcdef123456",
      proof_summary: "Empirically validated",
      resolved_at: "2026-08-22T01:00:00.000Z",
    });

    expect(validProof.task_id).toBe("t1");
    expect(validProof.test_path).toBe("tests/unit/example.test.ts");
    expect(validProof.assertions).toEqual(["assertion1", "assertion2"]);
    expect(validProof.runtime_ms).toBe(125);
    expect(validProof.commit_sha).toBe("abcdef123456");

    const verified = verifyFeedbackEmpiricalSealing(validProof, {
      requireCommitSha: true,
      requireTestPath: true,
    });
    expect(verified.isValid).toBe(true);

    const invalid = verifyFeedbackEmpiricalSealing(
      { task_id: "t1", resolved_at: "2026-08-22T00:00:00.000Z" },
      { requireCommitSha: true },
    );
    expect(invalid.isValid).toBe(false);
    expect(invalid.reason).toBeDefined();
  });

  it("seals feedback item resolution with empirical proof", () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-seal-test",
        title: "Test Sealing",
        content: "Requires empirical proof",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
        status: "ADMITTED",
        candidate_id: "cand-seal-test",
      },
      queueFile,
    );

    const proof: FeedbackResolutionProof = {
      task_id: "cand-seal-test",
      test_path: "tests/unit/seal.test.ts",
      test_assertion: "10 assertions passed",
      assertions: 10,
      runtime_ms: 45,
      commit_sha: "9876543210fed",
      proof_summary: "Empirically verified with 10 assertions in 45ms",
      resolved_at: "2026-08-22T02:00:00.000Z",
    };

    // Seal by candidate_id
    const sealed = sealFeedbackResolution("cand-seal-test", proof, { customPath: queueFile });
    expect(sealed.id).toBe("fb-seal-test");
    expect(sealed.status).toBe("COMPLETED");
    expect(sealed.test_path).toBe("tests/unit/seal.test.ts");
    expect(sealed.assertions).toBe(10);
    expect(sealed.runtime_ms).toBe(45);
    expect(sealed.commit_sha).toBe("9876543210fed");
    expect(sealed.resolution?.task_id).toBe("cand-seal-test");
    expect(sealed.resolution?.runtime_ms).toBe(45);

    const read = readFeedbackQueue(queueFile);
    expect(read).toHaveLength(1);
    expect(read[0]?.status).toBe("COMPLETED");
    expect(read[0]?.test_path).toBe("tests/unit/seal.test.ts");
    expect(read[0]?.commit_sha).toBe("9876543210fed");
    expect(read[0]?.resolution?.assertions).toBe(10);

    teardown();
  });

  it("backpropagates resolution records to matching queue items", () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-bp-1",
        title: "Item 1",
        content: "Content 1",
        priority: "NORMAL",
        category: "CLI_TOOLING",
        status: "PENDING",
      },
      queueFile,
    );

    appendFeedbackItem(
      {
        id: "fb-bp-2",
        title: "Item 2",
        content: "Content 2",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "ARCHITECTURE",
        status: "ADMITTED",
        candidate_id: "task-assigned-2",
      },
      queueFile,
    );

    appendFeedbackItem(
      {
        id: "fb-bp-3",
        title: "Item 3",
        content: "Content 3",
        priority: "LOW",
        category: "DOCUMENTATION",
        status: "PENDING",
      },
      queueFile,
    );

    const updated = backpropagateFeedbackResolution(
      [
        {
          id: "fb-bp-1",
          test_path: "tests/unit/bp1.test.ts",
          assertions: 5,
          runtime_ms: 32,
          commit_sha: "commit1111",
          proof_summary: "5 tests passed in 32ms",
          completed_at: "2026-08-22T03:00:00.000Z",
        },
        {
          id: "task-assigned-2",
          test_path: "tests/unit/bp2.test.ts",
          assertions: 8,
          runtime_ms: 54,
          commit_sha: "commit2222",
          proof_summary: "8 tests passed in 54ms",
          completed_at: "2026-08-22T03:10:00.000Z",
        },
      ],
      queueFile,
    );

    expect(updated).toHaveLength(2);

    const items = readFeedbackQueue(queueFile);
    const item1 = items.find((i) => i.id === "fb-bp-1");
    expect(item1?.status).toBe("COMPLETED");
    expect(item1?.test_path).toBe("tests/unit/bp1.test.ts");
    expect(item1?.assertions).toBe(5);
    expect(item1?.runtime_ms).toBe(32);
    expect(item1?.commit_sha).toBe("commit1111");
    expect(item1?.resolution?.task_id).toBe("fb-bp-1");

    const item2 = items.find((i) => i.id === "fb-bp-2");
    expect(item2?.status).toBe("COMPLETED");
    expect(item2?.test_path).toBe("tests/unit/bp2.test.ts");
    expect(item2?.assertions).toBe(8);
    expect(item2?.runtime_ms).toBe(54);
    expect(item2?.commit_sha).toBe("commit2222");
    expect(item2?.resolution?.task_id).toBe("task-assigned-2");

    const item3 = items.find((i) => i.id === "fb-bp-3");
    expect(item3?.status).toBe("PENDING");
    expect(item3?.resolution).toBeUndefined();

    teardown();
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies feedback queue files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/mind/feedback-queue.ts"),
      join(process.cwd(), "olt/scripts/src/cli/commands/feedback-ops.ts"),
      join(process.cwd(), "tests/unit/mind/feedback-queue.test.ts"),
    ];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      if (!existsSync(filePath)) continue;
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
