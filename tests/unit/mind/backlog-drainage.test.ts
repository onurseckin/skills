import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  autonomousCreativeOverload,
  drainBacklogOnRunCompletion,
  scanCharterGaps,
  scanCodeQuality,
  scanTestCoverage,
} from "../../../orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts";
import {
  readFeedbackQueue,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import { readCompletedTasksLedger } from "../../../orchestrating-long-tasks/scripts/src/mind/completed-tasks.ts";

describe("Mind Backlog Drainage & Autonomous Creative Overload", () => {
  const tmpDir = join(process.cwd(), ".tmp", "test-backlog-drainage");
  const backlogPath = join(tmpDir, "backlog.jsonl");
  const completedTasksPath = join(tmpDir, "completed-tasks.jsonl");

  test("drainBacklogOnRunCompletion atomically archives completed tasks into completed ledger", () => {
    mkdirSync(tmpDir, { recursive: true });

    const initialItems: FeedbackItem[] = [
      {
        id: "fb-1",
        title: "Implement feature A",
        content: "Feature A description",
        status: "COMPLETED",
        priority: "NORMAL",
        category: "CORE_ENGINE",
        timestamp: "2026-08-23T00:00:00.000Z",
      },
      {
        id: "fb-2",
        title: "Implement feature B",
        content: "Feature B description",
        status: "PENDING",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "ARCHITECTURE",
        timestamp: "2026-08-23T00:01:00.000Z",
      },
      {
        id: "fb-3",
        title: "Implement feature C",
        content: "Feature C description",
        status: "ADMITTED",
        priority: "NORMAL",
        category: "CLI_TOOLING",
        timestamp: "2026-08-23T00:02:00.000Z",
      },
    ];

    writeFeedbackQueue(initialItems, backlogPath);

    // Call drainage indicating fb-3 was completed under run-1
    const drainResult = drainBacklogOnRunCompletion({
      runId: "run-001",
      commitSha: "abc1234567",
      testPath: "tests/unit/sample.test.ts",
      completedTasks: ["fb-3"],
      backlogPath,
      completedTasksPath,
    });

    // fb-1 (status: COMPLETED) and fb-3 (completedTasks: ["fb-3"]) should be drained!
    expect(drainResult.drainedCount).toBe(2);
    expect(drainResult.remainingBacklogCount).toBe(1);

    // Verify remaining backlog
    const remainingBacklog = readFeedbackQueue(backlogPath);
    expect(remainingBacklog.length).toBe(1);
    expect(remainingBacklog[0]!.id).toBe("fb-2");

    // Verify completed archive ledger
    const completedRecords = readCompletedTasksLedger(completedTasksPath);
    expect(completedRecords.length).toBe(2);
    expect(completedRecords.some((r) => r.id === "fb-1")).toBe(true);
    expect(completedRecords.some((r) => r.id === "fb-3")).toBe(true);

    const record3 = completedRecords.find((r) => r.id === "fb-3");
    expect(record3?.commit_sha).toBe("abc1234567");
    expect(record3?.test_path).toBe("tests/unit/sample.test.ts");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("autonomous scanner functions return structured insights", () => {
    const quality = scanCodeQuality();
    expect(quality.issues).toBeDefined();
    expect(quality.suggestions).toBeDefined();

    const coverage = scanTestCoverage();
    expect(coverage.testedFiles).toBeGreaterThan(0);

    const charter = scanCharterGaps();
    expect(charter.openGaps).toBeDefined();
  });

  test("autonomousCreativeOverload synthesizes smart tasks on empty active queue", () => {
    const result = autonomousCreativeOverload(process.cwd(), { maxTasks: 3 });
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.anti_batching_enforced).toBe(true);
  });
});
