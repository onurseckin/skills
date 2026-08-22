import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatCompletedTasksBrief,
  getCompletedTasksStats,
  readCompletedTasksLedger,
  recordCompletedTask,
  recordCompletedTasksBatch,
  resolveBlundersPath,
  resolveCompletedTasksLedgerPath,
  validateCompletedTaskRecord,
  validateCompletedTaskSource,
  validateCompletedTaskStatus,
  writeCompletedTasksLedger,
  type CompletedTaskRecord,
} from "../../../orchestrating-long-tasks/scripts/src/mind/completed-tasks.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Completed Tasks Ledger Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-completed-tasks");
  const ledgerFile = join(testDir, "COMPLETED_TASKS.jsonl");
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const blundersFile = join(testDir, "blunders.jsonl");

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

  it("resolves completed tasks ledger path correctly", () => {
    const explicit = resolveCompletedTasksLedgerPath("/custom/path/COMPLETED_TASKS.jsonl");
    expect(explicit).toBe("/custom/path/COMPLETED_TASKS.jsonl");

    const resolved = resolveCompletedTasksLedgerPath();
    expect(typeof resolved).toBe("string");
    expect(resolved.endsWith(".capsules/COMPLETED_TASKS.jsonl")).toBe(true);

    const blunderExplicit = resolveBlundersPath("/custom/path/blunders.jsonl");
    expect(blunderExplicit).toBe("/custom/path/blunders.jsonl");

    const blunderResolved = resolveBlundersPath();
    expect(typeof blunderResolved).toBe("string");
    expect(blunderResolved.endsWith(".capsules/blunders.jsonl")).toBe(true);
  });

  it("returns empty array when ledger file does not exist", () => {
    setup();
    const items = readCompletedTasksLedger(ledgerFile);
    expect(items).toEqual([]);
    teardown();
  });

  it("writes and reads completed tasks from ledger", () => {
    setup();
    const task1: CompletedTaskRecord = {
      id: "task-01",
      source: "task_queue",
      title: "Implement Auth Flow",
      status: "COMPLETED",
      generation_id: "gen-1",
      commit_sha: "abc1234",
      proof_summary: "bun test tests/unit/auth.test.ts passes",
      completed_at: "2026-08-22T02:00:00.000Z",
      category: "CORE_ENGINE",
      metadata: { priority: "HIGH" },
    };

    const task2: CompletedTaskRecord = {
      id: "blunder-01",
      source: "blunder",
      title: "Fix Null Pointer in Watchdog",
      status: "RESOLVED",
      proof_summary: "Fixed undefined check in watchdog.ts",
      completed_at: "2026-08-22T02:10:00.000Z",
      category: "WATCHDOG",
    };

    writeCompletedTasksLedger([task1, task2], ledgerFile);

    const read = readCompletedTasksLedger(ledgerFile);
    expect(read).toHaveLength(2);
    expect(read[0]?.id).toBe("task-01");
    expect(read[0]?.source).toBe("task_queue");
    expect(read[0]?.status).toBe("COMPLETED");
    expect(read[0]?.commit_sha).toBe("abc1234");
    expect(read[1]?.id).toBe("blunder-01");
    expect(read[1]?.status).toBe("RESOLVED");

    teardown();
  });

  it("skips malformed lines when reading ledger", () => {
    setup();
    const content = [
      JSON.stringify({
        id: "task-valid",
        source: "direct",
        title: "Valid Task",
        status: "COMPLETED",
        proof_summary: "Validated",
        completed_at: "2026-08-22T00:00:00.000Z",
      }),
      "{ bad json line",
      JSON.stringify({ id: "", proof_summary: "Missing ID" }),
      JSON.stringify({
        id: "task-valid-2",
        source: "mind_plan",
        title: "Valid Task 2",
        status: "COMPLETED",
        proof_summary: "Validated 2",
        completed_at: "2026-08-22T00:05:00.000Z",
      }),
    ].join("\n");

    writeFileSync(ledgerFile, content, "utf8");

    const items = readCompletedTasksLedger(ledgerFile);
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("task-valid");
    expect(items[1]?.id).toBe("task-valid-2");

    teardown();
  });

  it("validates CompletedTaskRecord and normalizes sources and statuses", () => {
    expect(validateCompletedTaskSource("feedback_queue")).toBe("feedback_queue");
    expect(validateCompletedTaskSource("feedback")).toBe("feedback_queue");
    expect(validateCompletedTaskSource("blunder")).toBe("blunder");
    expect(validateCompletedTaskSource("blunders")).toBe("blunder");
    expect(validateCompletedTaskSource("task_queue")).toBe("task_queue");
    expect(validateCompletedTaskSource("queue")).toBe("task_queue");
    expect(validateCompletedTaskSource("mind_plan")).toBe("mind_plan");
    expect(validateCompletedTaskSource("plan")).toBe("mind_plan");
    expect(validateCompletedTaskSource("external")).toBe("external");
    expect(validateCompletedTaskSource("direct")).toBe("direct");
    expect(validateCompletedTaskSource("unknown")).toBe("direct");

    expect(validateCompletedTaskStatus("RESOLVED")).toBe("RESOLVED");
    expect(validateCompletedTaskStatus("resolved")).toBe("RESOLVED");
    expect(validateCompletedTaskStatus("COMPLETED")).toBe("COMPLETED");
    expect(validateCompletedTaskStatus("other")).toBe("COMPLETED");

    expect(() => validateCompletedTaskRecord(null)).toThrow(
      "CompletedTaskRecord must be an object",
    );
    expect(() => validateCompletedTaskRecord({ id: "", proof_summary: "test" })).toThrow(
      "requires non-empty id",
    );
    expect(() => validateCompletedTaskRecord({ id: "t1", proof_summary: "" })).toThrow(
      "requires non-empty proof_summary",
    );
  });

  it("handles duplicate recording by updating existing entry in ledger", () => {
    setup();
    const taskInitial: CompletedTaskRecord = {
      id: "task-dup",
      source: "task_queue",
      title: "Initial Title",
      status: "COMPLETED",
      proof_summary: "Initial proof",
      completed_at: "2026-08-22T01:00:00.000Z",
    };

    recordCompletedTask(taskInitial, { customPath: ledgerFile });

    const firstRead = readCompletedTasksLedger(ledgerFile);
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0]?.title).toBe("Initial Title");

    const taskUpdated: CompletedTaskRecord = {
      id: "task-dup",
      source: "task_queue",
      title: "Updated Title",
      status: "COMPLETED",
      proof_summary: "Updated proof summary",
      completed_at: "2026-08-22T01:30:00.000Z",
      commit_sha: "def5678",
    };

    recordCompletedTask(taskUpdated, { customPath: ledgerFile });

    const secondRead = readCompletedTasksLedger(ledgerFile);
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]?.id).toBe("task-dup");
    expect(secondRead[0]?.title).toBe("Updated Title");
    expect(secondRead[0]?.proof_summary).toBe("Updated proof summary");
    expect(secondRead[0]?.commit_sha).toBe("def5678");

    teardown();
  });

  it("records batch of completed tasks and deduplicates within batch and against ledger", () => {
    setup();
    const initial: CompletedTaskRecord = {
      id: "batch-existing",
      source: "direct",
      title: "Existing",
      status: "COMPLETED",
      proof_summary: "Existing proof",
      completed_at: "2026-08-22T00:00:00.000Z",
    };
    writeCompletedTasksLedger([initial], ledgerFile);

    const batch: CompletedTaskRecord[] = [
      {
        id: "batch-1",
        source: "mind_plan",
        title: "Batch Item 1",
        status: "COMPLETED",
        proof_summary: "Proof 1",
        completed_at: "2026-08-22T01:00:00.000Z",
        category: "ARCHITECTURE",
      },
      {
        id: "batch-existing",
        source: "direct",
        title: "Existing (Overwritten by Batch)",
        status: "COMPLETED",
        proof_summary: "New proof for existing",
        completed_at: "2026-08-22T01:05:00.000Z",
      },
      {
        id: "batch-dup",
        source: "external",
        title: "Batch Dup First",
        status: "COMPLETED",
        proof_summary: "Proof dup 1",
        completed_at: "2026-08-22T01:10:00.000Z",
      },
      {
        id: "batch-dup",
        source: "external",
        title: "Batch Dup Second",
        status: "COMPLETED",
        proof_summary: "Proof dup 2",
        completed_at: "2026-08-22T01:15:00.000Z",
      },
    ];

    const result = recordCompletedTasksBatch(batch, { customPath: ledgerFile });
    expect(result).toHaveLength(4);

    const read = readCompletedTasksLedger(ledgerFile);
    expect(read).toHaveLength(3); // batch-existing, batch-1, batch-dup

    const existingItem = read.find((r) => r.id === "batch-existing");
    expect(existingItem?.title).toBe("Existing (Overwritten by Batch)");
    expect(existingItem?.proof_summary).toBe("New proof for existing");

    const dupItem = read.find((r) => r.id === "batch-dup");
    expect(dupItem?.title).toBe("Batch Dup Second");

    const emptyResult = recordCompletedTasksBatch([], { customPath: ledgerFile });
    expect(emptyResult).toEqual([]);

    teardown();
  });

  it("calculates completed tasks statistics accurately", () => {
    const records: CompletedTaskRecord[] = [
      {
        id: "t1",
        source: "feedback_queue",
        title: "T1",
        status: "COMPLETED",
        proof_summary: "P1",
        completed_at: "2026-08-22T00:00:00.000Z",
        category: "CLI_TOOLING",
      },
      {
        id: "t2",
        source: "feedback_queue",
        title: "T2",
        status: "COMPLETED",
        proof_summary: "P2",
        completed_at: "2026-08-22T00:00:00.000Z",
        category: "CLI_TOOLING",
      },
      {
        id: "t3",
        source: "blunder",
        title: "T3",
        status: "RESOLVED",
        proof_summary: "P3",
        completed_at: "2026-08-22T00:00:00.000Z",
        category: "WATCHDOG",
      },
      {
        id: "t4",
        source: "direct",
        title: "T4",
        status: "COMPLETED",
        proof_summary: "P4",
        completed_at: "2026-08-22T00:00:00.000Z",
      },
    ];

    const stats = getCompletedTasksStats(records);
    expect(stats.total).toBe(4);
    expect(stats.by_source["feedback_queue"]).toBe(2);
    expect(stats.by_source["blunder"]).toBe(1);
    expect(stats.by_source["direct"]).toBe(1);
    expect(stats.by_category["CLI_TOOLING"]).toBe(2);
    expect(stats.by_category["WATCHDOG"]).toBe(1);
    expect(stats.by_category["uncategorized"]).toBe(1);

    const emptyStats = getCompletedTasksStats([]);
    expect(emptyStats.total).toBe(0);
    expect(emptyStats.by_source).toEqual({});
    expect(emptyStats.by_category).toEqual({});
  });

  it("seamlessly updates FEEDBACK_QUEUE.jsonl when resolving items", () => {
    setup();

    // Prepare initial FEEDBACK_QUEUE.jsonl
    const fbItems = [
      {
        id: "fb-101",
        timestamp: "2026-08-22T00:00:00.000Z",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        status: "PENDING",
        category: "CLI_TOOLING",
        title: "Add Completed Tasks Ledger",
        content: "We need an immutable completed tasks ledger.",
      },
      {
        id: "fb-102",
        timestamp: "2026-08-22T00:05:00.000Z",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
        title: "Other Feedback",
        content: "Should remain pending.",
      },
    ];

    writeFileSync(
      feedbackFile,
      fbItems.map((item) => JSON.stringify(item)).join("\n") + "\n",
      "utf8",
    );

    const completedTask: CompletedTaskRecord = {
      id: "fb-101",
      source: "feedback_queue",
      title: "Add Completed Tasks Ledger",
      status: "COMPLETED",
      generation_id: "gen-5",
      commit_sha: "abc9999",
      proof_summary: "Completed tasks ledger implemented and tested.",
      completed_at: "2026-08-22T02:00:00.000Z",
      category: "CLI_TOOLING",
    };

    recordCompletedTask(completedTask, {
      customPath: ledgerFile,
      feedbackQueuePath: feedbackFile,
      updateFeedbackQueue: true,
    });

    // Check ledger
    const ledger = readCompletedTasksLedger(ledgerFile);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.id).toBe("fb-101");

    // Check feedback queue
    const rawFb = readFileSync(feedbackFile, "utf8");
    const fbLines = rawFb
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(fbLines).toHaveLength(2);

    const updatedFb101 = fbLines.find((f) => f["id"] === "fb-101");
    expect(updatedFb101?.["status"]).toBe("COMPLETED");
    expect(updatedFb101?.["resolution_note"]).toBe(
      "Completed tasks ledger implemented and tested.",
    );
    expect(updatedFb101?.["processed_at"]).toBe("2026-08-22T02:00:00.000Z");

    const untouchedFb102 = fbLines.find((f) => f["id"] === "fb-102");
    expect(untouchedFb102?.["status"]).toBe("PENDING");

    teardown();
  });

  it("seamlessly updates blunders.jsonl when resolving blunder items", () => {
    setup();

    // Prepare initial blunders.jsonl
    const blunders = [
      {
        id: "blunder-99",
        type: "failing_test",
        severity: "critical",
        timestamp: "2026-08-22T00:10:00.000Z",
        category: "code_defect",
        status: "open",
        observation: "Unit test for completed-tasks failed",
        remediation: "Implement completed-tasks module properly",
      },
      {
        id: "blunder-100",
        type: "reasoning_error",
        severity: "warning",
        timestamp: "2026-08-22T00:15:00.000Z",
        category: "model_reasoning_error",
        status: "open",
        observation: "Other blunder",
        remediation: "Keep open",
      },
    ];

    writeFileSync(blundersFile, blunders.map((b) => JSON.stringify(b)).join("\n") + "\n", "utf8");

    const completedBlunder: CompletedTaskRecord = {
      id: "blunder-99",
      source: "blunder",
      title: "Fix Completed Tasks Unit Test",
      status: "RESOLVED",
      generation_id: "gen-6",
      commit_sha: "fed4321",
      proof_summary: "bun test tests/unit/mind/completed-tasks.test.ts passed 100%",
      completed_at: "2026-08-22T02:30:00.000Z",
      category: "code_defect",
    };

    recordCompletedTask(completedBlunder, {
      customPath: ledgerFile,
      blundersPath: blundersFile,
      updateBlunders: true,
    });

    // Check ledger
    const ledger = readCompletedTasksLedger(ledgerFile);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.id).toBe("blunder-99");
    expect(ledger[0]?.status).toBe("RESOLVED");

    // Check blunders log
    const rawBlunders = readFileSync(blundersFile, "utf8");
    const blunderLines = rawBlunders
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(blunderLines).toHaveLength(2);

    const updatedBlunder99 = blunderLines.find((b) => b["id"] === "blunder-99");
    expect(updatedBlunder99?.["status"]).toBe("resolved");
    const resolution = updatedBlunder99?.["resolution"] as Record<string, unknown>;
    expect(resolution).toBeDefined();
    expect(resolution["task_id"]).toBe("blunder-99");
    expect(resolution["test_assertion"]).toBe(
      "bun test tests/unit/mind/completed-tasks.test.ts passed 100%",
    );
    expect(resolution["resolved_at"]).toBe("2026-08-22T02:30:00.000Z");
    expect(resolution["commit_sha"]).toBe("fed4321");

    const untouchedBlunder100 = blunderLines.find((b) => b["id"] === "blunder-100");
    expect(untouchedBlunder100?.["status"]).toBe("open");

    teardown();
  });

  it("formats completed tasks brief with ⚡ Next Actions block <= 30 lines", () => {
    const records: CompletedTaskRecord[] = [
      {
        id: "p15-completed-tasks",
        source: "feedback_queue",
        title: "Implement Completed Tasks Ledger",
        status: "COMPLETED",
        proof_summary: "All unit tests pass",
        completed_at: "2026-08-22T02:30:00.000Z",
        category: "CLI_TOOLING",
      },
      {
        id: "blunder-02",
        source: "blunder",
        title: "Fix syntax error in scheduler",
        status: "RESOLVED",
        proof_summary: "Fixed syntax",
        completed_at: "2026-08-22T02:35:00.000Z",
        category: "code_defect",
      },
    ];

    const brief = formatCompletedTasksBrief(records);
    expect(brief).toContain("### Completed Tasks Ledger");
    expect(brief).toContain("- **Total Completed**: 2");
    expect(brief).toContain("- **By Source**: feedback_queue: 1, blunder: 1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain("`bun harness.ts mind:wake`");
    expect(brief).toContain("`bun harness.ts queue:list`");

    const lines = brief.split("\n");
    expect(lines.length).toBeLessThanOrEqual(30);

    // Empty records case
    const emptyBrief = formatCompletedTasksBrief([]);
    expect(emptyBrief).toContain("### Completed Tasks Ledger");
    expect(emptyBrief).toContain("- **Total Completed**: 0");
    expect(emptyBrief).toContain("No tasks completed yet in ledger");
    expect(emptyBrief).toContain("⚡ Next Actions:");
    expect(emptyBrief.split("\n").length).toBeLessThanOrEqual(30);

    // Truncation when maxLines is very small
    const truncatedBrief = formatCompletedTasksBrief(records, 5);
    expect(truncatedBrief.split("\n").length).toBeLessThanOrEqual(5);
    expect(truncatedBrief).toContain("truncated");
  });
});
