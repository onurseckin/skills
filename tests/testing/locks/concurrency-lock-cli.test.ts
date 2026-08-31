import { beforeEach, describe, expect, test } from "bun:test";
import { testSummaryCommand } from "../../../olt/scripts/src/cli/commands/test-summary.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  createTestSummaryRecord,
  formatTestSummaryMarkdown,
  getLatestTestSummary,
  resetConcurrencyLockStore,
  saveTestSummary,
  type TestSummaryRecord,
} from "../../../olt/scripts/src/testing/concurrency-lock.ts";
import { createSampleTestSummary, LOCKS_SUITES } from "./index.ts";

describe("concurrency-lock-cli (in-memory test summary memoization & CLI)", () => {
  beforeEach(() => {
    resetConcurrencyLockStore();
  });

  describe("Test Summary Memoization", () => {
    test("saves and retrieves test summary records in memory", async () => {
      const runDir = "/virtual/test-summaries/run-memo";
      expect(await getLatestTestSummary({ runDir })).toBeNull();

      const summary: TestSummaryRecord = createTestSummaryRecord({
        passed_count: 50,
        failed_count: 0,
        skipped_count: 3,
        duration_ms: 1250,
        coverage_percentage: 97.5,
        test_files_count: 12,
        scope: "full",
        agent_id: "agent-coordinator",
      });

      const savedPath = await saveTestSummary(summary, { runDir });
      expect(savedPath).toContain("summary-");

      const latest = await getLatestTestSummary({ runDir });
      expect(latest).not.toBeNull();
      expect(latest!.passed_count).toBe(50);
      expect(latest!.failed_count).toBe(0);
      expect(latest!.skipped_count).toBe(3);
      expect(latest!.duration_ms).toBe(1250);
      expect(latest!.coverage_percentage).toBe(97.5);
      expect(latest!.test_files_count).toBe(12);
      expect(latest!.scope).toBe("full");
      expect(latest!.agent_id).toBe("agent-coordinator");
    });

    test("formats test summary markdown with correct status badges", () => {
      const passing = createTestSummaryRecord({
        passed_count: 10,
        failed_count: 0,
        duration_ms: 100,
        coverage_percentage: 95.0,
        scope: "full",
      });
      const passMd = formatTestSummaryMarkdown(passing);
      expect(passMd).toContain("✅ PASSED");
      expect(passMd).toContain("95.0%");

      const failing = createTestSummaryRecord({
        passed_count: 8,
        failed_count: 2,
        duration_ms: 150,
        coverage_percentage: 88.0,
        scope: "scoped",
      });
      const failMd = formatTestSummaryMarkdown(failing);
      expect(failMd).toContain("❌ FAILED");
      expect(failMd).toContain("- **Failed**: 2");
    });
  });

  describe("CLI Command: test:summary", () => {
    test("returns empty status when no test summary exists", async () => {
      const runDir = "/virtual/test-summaries/empty";
      const result = await testSummaryCommand({ run: runDir });
      expect(result.found).toBe(false);
      expect(result.summary).toBeNull();
      expect(String(result.markdown)).toContain("No test summary records found");
    });

    test("records and queries summary via testSummaryCommand", async () => {
      const runDir = "/virtual/test-summaries/save";
      const res = await testSummaryCommand({
        run: runDir,
        passed: "25",
        failed: "0",
        skipped: "1",
        duration: "450",
        coverage: "98.2",
        commit: "abcdef123456",
        files: "5",
        scope: "scoped",
        agent: "implementer-p42",
      });
      expect(res.saved).toBe(true);
      expect(res.passed_count).toBe(25);
      expect(res.failed_count).toBe(0);
      expect(res.skipped_count).toBe(1);
      expect(res.duration_ms).toBe(450);
      expect(res.coverage_percentage).toBe(98.2);
      expect(res.scope).toBe("scoped");
      expect(String(res.markdown)).toContain("✅ PASSED");

      const q = await testSummaryCommand({ run: runDir });
      expect(q.found).toBe(true);
      expect(q.passed_count).toBe(25);
      expect(q.failed_count).toBe(0);
    });

    test("executes via CLI execute dispatcher", async () => {
      const runDir = "/virtual/test-summaries/exec";
      const execResult = await execute([
        "test:summary",
        "--run",
        runDir,
        "--passed",
        "30",
        "--failed",
        "0",
        "--duration",
        "320",
      ]);
      expect(execResult.saved).toBe(true);
      expect(execResult.passed_count).toBe(30);

      const viewResult = await execute(["test:summary", "--run", runDir]);
      expect(viewResult.found).toBe(true);
      expect(viewResult.passed_count).toBe(30);

      const sample = createSampleTestSummary({ passed_count: 99 });
      expect(sample.passed_count).toBe(99);
      expect(LOCKS_SUITES.length).toBe(3);
    });
  });
});
