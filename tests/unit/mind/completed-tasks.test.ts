import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  formatCompletedTasksBrief,
  getCompletedTasksStats,
  migrateCompletedTasksLedger,
  readCompletedTasksLedger,
  recordCompletedTask,
  recordCompletedTasksBatch,
  resolveDefectsPath,
  resolveCanonicalDefectsPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCanonicalCompletedTasksPath,
  resolveCanonicalObservationsPath,
  resolveCompletedTasksLedgerPath,
  validateCompletedTaskRecord,
  validateCompletedTaskSource,
  validateCompletedTaskStatus,
  writeCompletedTasksLedger,
  type CompletedTaskRecord,
} from "../../../olt/scripts/src/mind/completed-tasks.ts";
import {
  popNextEligibleTaskWithCleanup,
  readTaskQueue,
  writeTaskQueue,
} from "../../../olt/scripts/src/mind/task-queue.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Completed Tasks Ledger Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-completed-tasks");
  const ledgerFile = join(testDir, "COMPLETED_TASKS.jsonl");
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const defectsFile = join(testDir, "defects.jsonl");

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

    const defectExplicit = resolveDefectsPath("/custom/path/defects.jsonl");
    expect(defectExplicit).toBe("/custom/path/defects.jsonl");

    const defectResolved = resolveDefectsPath();
    expect(typeof defectResolved).toBe("string");
    expect(defectResolved.endsWith(".capsules/defects.jsonl")).toBe(true);

    const canonicalTasks = resolveCanonicalCompletedTasksPath("/tmp/test");
    expect(canonicalTasks).toBe("/tmp/test/.capsules/mind/queue/completed-tasks.jsonl");
    const todoTasks = resolveCanonicalCompletedTasksPath("/tmp/test", true);
    expect(todoTasks).toBe("/tmp/test/.capsules/todo/completed-tasks.jsonl");

    const canonicalDefects = resolveCanonicalDefectsPath("/tmp/test");
    expect(canonicalDefects).toBe("/tmp/test/.capsules/mind/queue/defects.jsonl");
    const todoDefects = resolveCanonicalDefectsPath("/tmp/test", true);
    expect(todoDefects).toBe("/tmp/test/.capsules/todo/defects.jsonl");

    const canonicalCompletedDefects = resolveCanonicalCompletedDefectsPath("/tmp/test");
    expect(canonicalCompletedDefects).toBe(
      "/tmp/test/.capsules/mind/queue/completed-defects.jsonl",
    );
    const todoCompletedDefects = resolveCanonicalCompletedDefectsPath("/tmp/test", true);
    expect(todoCompletedDefects).toBe("/tmp/test/.capsules/todo/completed-defects.jsonl");

    const canonicalObs = resolveCanonicalObservationsPath("/tmp/test");
    expect(canonicalObs).toBe("/tmp/test/.capsules/mind/queue/observations.jsonl");
    const todoObs = resolveCanonicalObservationsPath("/tmp/test", true);
    expect(todoObs).toBe("/tmp/test/.capsules/todo/observations.jsonl");
  });

  it("migrates completed tasks ledger from legacy path to canonical path", () => {
    const legacyPath = join(testDir, "legacy-COMPLETED_TASKS.jsonl");
    const canonicalPath = join(testDir, "canonical-completed-tasks.jsonl");

    const sampleRecord: CompletedTaskRecord = {
      id: "task-migrated-01",
      source: "task_queue",
      title: "Migrated completed task",
      status: "COMPLETED",
      proof_summary: "Validated migration",
      completed_at: "2026-08-22T02:00:00.000Z",
    };
    writeCompletedTasksLedger([sampleRecord], legacyPath);

    const migRes = migrateCompletedTasksLedger({
      sourcePath: legacyPath,
      targetPath: canonicalPath,
    });
    expect(migRes.migrated).toBe(true);
    expect(migRes.count).toBe(1);

    const canonicalItems = readCompletedTasksLedger(canonicalPath);
    expect(canonicalItems).toHaveLength(1);
    expect(canonicalItems[0]?.id).toBe("task-migrated-01");
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
      id: "defect-01",
      source: "defect",
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
    expect(read[1]?.id).toBe("defect-01");
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
    expect(validateCompletedTaskSource("defect")).toBe("defect");
    expect(validateCompletedTaskSource("defects")).toBe("defect");
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
        source: "defect",
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
    expect(stats.by_source["defect"]).toBe(1);
    expect(stats.by_source["direct"]).toBe(1);
    expect(stats.by_category["CLI_TOOLING"]).toBe(2);
    expect(stats.by_category["WATCHDOG"]).toBe(1);
    expect(stats.by_category["uncategorized"]).toBe(1);

    const emptyStats = getCompletedTasksStats([]);
    expect(emptyStats.total).toBe(0);
    expect(emptyStats.by_source).toEqual({});
    expect(emptyStats.by_category).toEqual({});
  });

  it("seamlessly updates FEEDBACK_QUEUE.jsonl with empirical sealing when resolving items", () => {
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
        status: "ADMITTED",
        category: "GENERAL",
        title: "Other Feedback",
        content: "Assigned to candidate.",
        candidate_id: "task-cand-102",
      },
      {
        id: "fb-103",
        timestamp: "2026-08-22T00:10:00.000Z",
        priority: "LOW",
        status: "PENDING",
        category: "DOCUMENTATION",
        title: "Untouched Feedback",
        content: "Should remain pending.",
      },
    ];

    writeFileSync(
      feedbackFile,
      fbItems.map((item) => JSON.stringify(item)).join("\n") + "\n",
      "utf8",
    );

    const completedTask1: CompletedTaskRecord = {
      id: "fb-101",
      source: "feedback_queue",
      title: "Add Completed Tasks Ledger",
      status: "COMPLETED",
      generation_id: "gen-5",
      commit_sha: "abc9999",
      test_path: "tests/unit/mind/completed-tasks.test.ts",
      assertions: 24,
      runtime_ms: 68,
      proof_summary: "Completed tasks ledger implemented and tested.",
      completed_at: "2026-08-22T02:00:00.000Z",
      category: "CLI_TOOLING",
    };

    const completedTask2: CompletedTaskRecord = {
      id: "task-cand-102",
      source: "task_queue",
      title: "Resolve Candidate Feedback",
      status: "COMPLETED",
      generation_id: "gen-5",
      commit_sha: "def8888",
      test_path: "tests/unit/mind/cand.test.ts",
      assertions: ["assertion A", "assertion B"],
      runtime_ms: 110,
      proof_summary: "Candidate task resolved with 2 assertions.",
      completed_at: "2026-08-22T02:15:00.000Z",
      category: "GENERAL",
    };

    recordCompletedTasksBatch([completedTask1, completedTask2], {
      customPath: ledgerFile,
      feedbackQueuePath: feedbackFile,
      updateFeedbackQueue: true,
    });

    // Check ledger
    const ledger = readCompletedTasksLedger(ledgerFile);
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.id).toBe("fb-101");
    expect(ledger[0]?.test_path).toBe("tests/unit/mind/completed-tasks.test.ts");
    expect(ledger[0]?.assertions).toBe(24);
    expect(ledger[0]?.runtime_ms).toBe(68);

    // Check feedback queue: completed items (fb-101 and fb-102) are purged from active queue
    const rawFb = readFileSync(feedbackFile, "utf8");
    const fbLines = rawFb
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(fbLines).toHaveLength(1);

    const untouchedFb103 = fbLines.find((f) => f["id"] === "fb-103");
    expect(untouchedFb103?.["status"]).toBe("PENDING");
    expect(untouchedFb103?.["resolution"]).toBeUndefined();

    teardown();
  });

  it("seamlessly updates defects.jsonl when resolving defect items", () => {
    setup();

    // Prepare initial defects.jsonl
    const defects = [
      {
        id: "defect-99",
        type: "failing_test",
        severity: "critical",
        timestamp: "2026-08-22T00:10:00.000Z",
        category: "code_defect",
        status: "open",
        observation: "Unit test for completed-tasks failed",
        remediation: "Implement completed-tasks module properly",
      },
      {
        id: "defect-100",
        type: "reasoning_error",
        severity: "warning",
        timestamp: "2026-08-22T00:15:00.000Z",
        category: "model_reasoning_error",
        status: "open",
        observation: "Other defect",
        remediation: "Keep open",
      },
    ];

    writeFileSync(defectsFile, defects.map((b) => JSON.stringify(b)).join("\n") + "\n", "utf8");

    const completedDefect: CompletedTaskRecord = {
      id: "defect-99",
      source: "defect",
      title: "Fix Completed Tasks Unit Test",
      status: "RESOLVED",
      generation_id: "gen-6",
      commit_sha: "fed4321",
      test_path: "tests/unit/mind/completed-tasks.test.ts",
      runtime_ms: 55,
      proof_summary: "bun test tests/unit/mind/completed-tasks.test.ts passed 100%",
      completed_at: "2026-08-22T02:30:00.000Z",
      category: "code_defect",
    };

    recordCompletedTask(completedDefect, {
      customPath: ledgerFile,
      defectsPath: defectsFile,
      updateDefects: true,
    });

    // Check ledger
    const ledger = readCompletedTasksLedger(ledgerFile);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.id).toBe("defect-99");
    expect(ledger[0]?.status).toBe("RESOLVED");

    // Check defects log: resolved defect-99 is purged from active defects file
    const rawDefects = readFileSync(defectsFile, "utf8");
    const defectLines = rawDefects
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(defectLines).toHaveLength(1);

    const untouchedDefect100 = defectLines.find((b) => b["id"] === "defect-100");
    expect(untouchedDefect100?.["status"]).toBe("open");

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
        id: "defect-02",
        source: "defect",
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
    expect(brief).toContain("- **By Source**: feedback_queue: 1, defect: 1");
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

  it("pops next eligible task and atomically cleans up completed items via popNextEligibleTaskWithCleanup", () => {
    setup();
    const queueFile = join(testDir, "test-task-queue.jsonl");
    const testLedger = join(testDir, "test-completed-archive.jsonl");

    writeTaskQueue(
      [
        {
          id: "task-done-1",
          title: "Finished Task",
          status: "COMPLETED",
          completed_at: "2026-08-22T01:00:00.000Z",
          dependencies: [],
          attempts: 0,
        },
        {
          id: "task-ready-2",
          title: "Pending Ready Task",
          status: "PENDING",
          dependencies: [],
          attempts: 0,
        },
      ],
      queueFile,
    );

    const popResult = popNextEligibleTaskWithCleanup({
      agentId: "test-agent",
      customPath: queueFile,
      completedTasksPath: testLedger,
    });

    expect(popResult).not.toBeNull();
    expect(popResult?.task.id).toBe("task-ready-2");
    expect(popResult?.prunedCount).toBe(1);

    const remaining = readTaskQueue(queueFile);
    expect(remaining.some((t) => t.id === "task-done-1")).toBe(false);
    teardown();
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies completed tasks files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/mind/completed-tasks.ts"),
      join(process.cwd(), "tests/unit/mind/completed-tasks.test.ts"),
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
