import { describe, expect, it } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  __setCompletedTasksPersistenceTestHook,
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
} from "../../olt/scripts/src/mind/archival/completed/index.ts";
import {
  popNextEligibleTaskWithCleanup,
  readTaskQueue,
  writeTaskQueue,
} from "../../olt/scripts/src/task/queue/index.ts";
import {
  appendFeedbackItem,
  readFeedbackQueue,
} from "../../olt/scripts/src/mind/feedback/queue/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

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

  function spawnLedgerChild(id: string): Bun.Subprocess<"pipe", "pipe", "inherit"> {
    const modulePath = resolve(process.cwd(), "olt/scripts/src/mind/archival/completed/index.ts");
    return Bun.spawn(
      [
        "bun",
        "-e",
        `import { recordCompletedTask } from ${JSON.stringify(modulePath)}; recordCompletedTask({ id: process.env.ID, source: 'direct', title: process.env.ID, status: 'COMPLETED', proof_summary: 'proof', completed_at: '2026-08-22T00:00:00.000Z' }, { customPath: process.env.LEDGER });`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, ID: id, LEDGER: ledgerFile },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }

  it("resolves completed tasks ledger path correctly", () => {
    const explicit = resolveCompletedTasksLedgerPath("/custom/path/COMPLETED_TASKS.jsonl");
    expect(explicit).toBe("/custom/path/COMPLETED_TASKS.jsonl");

    const resolved = resolveCompletedTasksLedgerPath();
    expect(typeof resolved).toBe("string");
    expect(resolved.endsWith("completed-tasks.jsonl")).toBe(true);

    const defectExplicit = resolveDefectsPath("/custom/path/defects.jsonl");
    expect(defectExplicit).toBe("/custom/path/defects.jsonl");

    const defectResolved = resolveDefectsPath();
    expect(typeof defectResolved).toBe("string");
    expect(defectResolved.endsWith("defects.jsonl")).toBe(true);

    const canonicalTasks = resolveCanonicalCompletedTasksPath("/tmp/test");
    expect(canonicalTasks).toBe("/tmp/test/.olt/completed-tasks.jsonl");
    const todoTasks = resolveCanonicalCompletedTasksPath("/tmp/test", true);
    expect(todoTasks).toBe("/tmp/test/.olt/completed-tasks.jsonl");

    const canonicalDefects = resolveCanonicalDefectsPath("/tmp/test");
    expect(canonicalDefects).toBe("/tmp/test/.olt/defects.jsonl");
    const todoDefects = resolveCanonicalDefectsPath("/tmp/test", true);
    expect(todoDefects).toBe("/tmp/test/.olt/defects.jsonl");

    const canonicalCompletedDefects = resolveCanonicalCompletedDefectsPath("/tmp/test");
    expect(canonicalCompletedDefects).toBe("/tmp/test/.olt/completed-defects.jsonl");
    const todoCompletedDefects = resolveCanonicalCompletedDefectsPath("/tmp/test", true);
    expect(todoCompletedDefects).toBe("/tmp/test/.olt/completed-defects.jsonl");

    const canonicalObs = resolveCanonicalObservationsPath("/tmp/test");
    expect(canonicalObs).toBe("/tmp/test/.olt/telemetry.jsonl");
    const todoObs = resolveCanonicalObservationsPath("/tmp/test", true);
    expect(todoObs).toBe("/tmp/test/.olt/telemetry.jsonl");
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

  it("preserves bytes before rename and reports uncertainty after rename", () => {
    setup();
    const base: CompletedTaskRecord = {
      id: "prior",
      source: "direct",
      title: "Prior",
      status: "COMPLETED",
      proof_summary: "proof",
      completed_at: "2026-08-22T00:00:00.000Z",
    };
    recordCompletedTask(base, { customPath: ledgerFile });
    const prior = readFileSync(ledgerFile, "utf8");
    for (const stage of ["before_write", "before_file_fsync", "before_rename"] as const) {
      __setCompletedTasksPersistenceTestHook((actual) => {
        if (actual === stage) throw new Error(stage);
      });
      expect(() =>
        recordCompletedTask({ ...base, id: stage }, { customPath: ledgerFile }),
      ).toThrow();
      expect(readFileSync(ledgerFile, "utf8")).toBe(prior);
    }
    for (const stage of ["after_rename", "before_directory_fsync"] as const) {
      __setCompletedTasksPersistenceTestHook((actual) => {
        if (actual === stage) throw new Error(stage);
      });
      expect(() => recordCompletedTask({ ...base, id: stage }, { customPath: ledgerFile })).toThrow(
        "outcome is uncertain",
      );
      __setCompletedTasksPersistenceTestHook(undefined);
      expect(readCompletedTasksLedger(ledgerFile).some((item) => item.id === stage)).toBe(true);
    }
    __setCompletedTasksPersistenceTestHook(undefined);
    teardown();
  });

  it("refuses final symlink and hardlink ledgers without changing sentinels", () => {
    setup();
    const sentinel = join(testDir, "sentinel.jsonl");
    writeFileSync(sentinel, "sentinel\n", "utf8");
    symlinkSync(sentinel, ledgerFile);
    expect(() => readCompletedTasksLedger(ledgerFile)).toThrow(HarnessError);
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel\n");
    rmSync(ledgerFile);
    writeFileSync(ledgerFile, "sentinel\n", "utf8");
    const alias = join(testDir, "ledger-alias.jsonl");
    linkSync(ledgerFile, alias);
    expect(() => readCompletedTasksLedger(ledgerFile)).toThrow(HarnessError);
    expect(readFileSync(alias, "utf8")).toBe("sentinel\n");
    teardown();
  });

  it("retains distinct child records and leaves same-ID races as one whole record", async () => {
    setup();
    const distinct = [spawnLedgerChild("child-one"), spawnLedgerChild("child-two")];
    expect(await distinct[0].exited).toBe(0);
    expect(await distinct[1].exited).toBe(0);
    expect(
      readCompletedTasksLedger(ledgerFile)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["child-one", "child-two"]);
    rmSync(ledgerFile, { force: true });
    const duplicate = [spawnLedgerChild("same"), spawnLedgerChild("same")];
    expect(await duplicate[0].exited).toBe(0);
    expect(await duplicate[1].exited).toBe(0);
    const raw = readFileSync(ledgerFile, "utf8");
    expect(() => JSON.parse(raw.trim())).not.toThrow();
    expect(readCompletedTasksLedger(ledgerFile).map((item) => item.id)).toEqual(["same"]);
    teardown();
  });

  it("refuses a symlinked ledger parent without touching its external sentinel", () => {
    setup();
    const external = join(testDir, "external");
    const linkedParent = join(testDir, "linked-parent");
    mkdirSync(external);
    const sentinel = join(external, "ledger.jsonl");
    writeFileSync(sentinel, "sentinel\n", "utf8");
    symlinkSync(external, linkedParent);
    expect(() =>
      recordCompletedTask(
        {
          id: "blocked",
          source: "direct",
          title: "Blocked",
          status: "COMPLETED",
          proof_summary: "proof",
          completed_at: "2026-08-22T00:00:00.000Z",
        },
        { customPath: join(linkedParent, "ledger.jsonl") },
      ),
    ).toThrow();
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel\n");
    teardown();
  });

  it("merges migration and batch updates through the target ledger lock", () => {
    setup();
    const source = join(testDir, "source.jsonl");
    writeCompletedTasksLedger(
      [
        {
          id: "migrated",
          source: "direct",
          title: "Migrated",
          status: "COMPLETED",
          proof_summary: "proof",
          completed_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      source,
    );
    recordCompletedTasksBatch(
      [
        {
          id: "batch",
          source: "direct",
          title: "Batch",
          status: "COMPLETED",
          proof_summary: "proof",
          completed_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      { customPath: ledgerFile },
    );
    migrateCompletedTasksLedger({ sourcePath: source, targetPath: ledgerFile });
    expect(
      readCompletedTasksLedger(ledgerFile)
        .map((item) => item.id)
        .sort(),
    ).toEqual(["batch", "migrated"]);
    teardown();
  });

  it("refuses malformed lines when reading ledger", () => {
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

    expect(() => readCompletedTasksLedger(ledgerFile)).toThrow(HarnessError);

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
    expect(() => validateCompletedTaskSource("unknown")).toThrow(HarnessError);

    expect(validateCompletedTaskStatus("RESOLVED")).toBe("RESOLVED");
    expect(validateCompletedTaskStatus("resolved")).toBe("RESOLVED");
    expect(validateCompletedTaskStatus("COMPLETED")).toBe("COMPLETED");
    expect(() => validateCompletedTaskStatus("other")).toThrow(HarnessError);

    expect(() => validateCompletedTaskRecord(null)).toThrow(
      "CompletedTaskRecord must be an object",
    );
    expect(() => validateCompletedTaskRecord({ id: "", proof_summary: "test" })).toThrow(
      "requires non-empty id",
    );
    expect(() =>
      validateCompletedTaskRecord({
        id: "t1",
        source: "direct",
        title: "Title",
        status: "COMPLETED",
        completed_at: "2026-08-22T00:00:00.000Z",
        proof_summary: "",
      }),
    ).toThrow("requires non-empty proof_summary");
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

    const emptyResult = recordCompletedTasksBatch([], {
      customPath: ledgerFile,
    });
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

  it("completed-task archival does not erase a concurrent feedback append", async () => {
    setup();
    appendFeedbackItem(
      {
        id: "fb-archive",
        title: "archive",
        content: "done",
        priority: "NORMAL",
        category: "GENERAL",
        status: "COMPLETED",
      },
      feedbackFile,
    );
    const modulePath = join(process.cwd(), "olt/scripts/src/mind/feedback/queue/index.ts");
    const child = Bun.spawn({
      cmd: [
        "bun",
        "-e",
        `import { appendFeedbackItem } from ${JSON.stringify(modulePath)}; appendFeedbackItem({ id: "fb-archive-concurrent", title: "concurrent", content: "keep", priority: "NORMAL", category: "GENERAL", status: "PENDING" }, process.argv.at(-1));`,
        feedbackFile,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    recordCompletedTask(
      {
        id: "fb-archive",
        source: "feedback_queue",
        title: "archive",
        status: "COMPLETED",
        proof_summary: "archive",
        completed_at: "2026-08-22T00:00:00.000Z",
      },
      {
        customPath: ledgerFile,
        updateFeedbackQueue: true,
        feedbackQueuePath: feedbackFile,
      },
    );
    expect(await child.exited).toBe(0);
    expect(readFeedbackQueue(feedbackFile).map((item) => item.id)).toEqual([
      "fb-archive-concurrent",
    ]);
    teardown();
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

  it("completed-task prune contention preserves a newly appended active defect", async () => {
    setup();
    writeFileSync(defectsFile, '{"id":"remove-me","status":"open"}\n', "utf8");
    const start = join(testDir, "defect-prune-start");
    const completedModule = new URL(
      "../../../olt/scripts/src/mind/archival/completed/index.ts",
      import.meta.url,
    ).href;
    const loggerModule = new URL(
      "../../../olt/scripts/src/logging/defect-logger.ts",
      import.meta.url,
    ).href;
    const recordScript = `
      import { recordCompletedTask } from ${JSON.stringify(completedModule)};
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(join(testDir, "defect-prune-ready-record"))}, "ready");
      while (!existsSync(${JSON.stringify(start)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      recordCompletedTask({ id: "remove-me", source: "defect", title: "remove", status: "RESOLVED", proof_summary: "proof", completed_at: "2026-08-22T02:30:00.000Z" }, { customPath: ${JSON.stringify(ledgerFile)}, defectsPath: ${JSON.stringify(defectsFile)}, updateDefects: true });
    `;
    const appendScript = `
      import { appendDefectLedgerRecord } from ${JSON.stringify(loggerModule)};
      import { existsSync, writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(join(testDir, "defect-prune-ready-append"))}, "ready");
      while (!existsSync(${JSON.stringify(start)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      appendDefectLedgerRecord(${JSON.stringify(defectsFile)}, { id: "new-active", status: "open", unknown: { preserve: true } });
    `;
    const record = Bun.spawn([process.execPath, "--eval", recordScript]);
    const append = Bun.spawn([process.execPath, "--eval", appendScript]);
    for (const ready of ["defect-prune-ready-record", "defect-prune-ready-append"]) {
      for (let attempt = 0; attempt < 100 && !existsSync(join(testDir, ready)); attempt += 1)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    writeFileSync(start, "go");
    expect(await Promise.all([record.exited, append.exited])).toEqual([0, 0]);
    expect(readFileSync(defectsFile, "utf8")).toBe(
      '{"id":"new-active","status":"open","unknown":{"preserve":true}}\n',
    );
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
          description: "Finished Task",
          priority: "MEDIUM",
          status: "COMPLETED",
          write_scope: ["done.ts"],
          gate: "gate",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          completed_at: "2026-08-22T01:00:00.000Z",
          dependencies: [],
          blocked_by: [],
          lease: null,
          source_type: "direct_prompt",
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T01:00:00.000Z",
          retry_count: 0,
          max_retries: 3,
        },
        {
          id: "task-ready-2",
          title: "Pending Ready Task",
          description: "Pending Ready Task",
          priority: "MEDIUM",
          status: "PENDING",
          write_scope: ["ready.ts"],
          gate: "gate",
          charter_goals: ["G1"],
          acceptance_criteria: [],
          dependencies: [],
          blocked_by: [],
          lease: null,
          source_type: "direct_prompt",
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T00:00:00.000Z",
          retry_count: 0,
          max_retries: 3,
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
      join(process.cwd(), "olt/scripts/src/mind/archival/completed/index.ts"),
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
