import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { testSummaryCommand } from "../../olt/scripts/src/cli/commands/test-summary.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterAll(async () => cleanupRoots(roots));

describe("test:summary CLI command", () => {
  test("returns empty summary when no test summary exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-summary-empty-"));
    roots.push(root);

    const result = await testSummaryCommand({
      run: root,
    });

    expect(result.found).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.markdown as string).toContain("No test summary records found");
  });

  test("saves and queries test summary with full options", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-summary-save-"));
    roots.push(root);

    // Save with percentage > 1
    const saveResult = await testSummaryCommand({
      run: root,
      passed: "50",
      failed: "0",
      skipped: "2",
      duration: "1500",
      coverage: "95.5",
      commit: "abc1234",
      files: "5",
      scope: "unit/cli",
      agent: "test-runner-1",
    });

    expect(saveResult.saved).toBe(true);
    expect(saveResult.passed_count).toBe(50);
    expect(saveResult.failed_count).toBe(0);
    expect(saveResult.skipped_count).toBe(2);
    expect(saveResult.coverage_percentage).toBe(95.5);
    expect(saveResult.scope).toBe("unit/cli");
    expect(typeof saveResult.saved_path).toBe("string");
    expect(typeof saveResult.markdown).toBe("string");

    // Query back
    const queryResult = await testSummaryCommand({
      run: root,
    });

    expect(queryResult.found).toBe(true);
    expect(queryResult.passed_count).toBe(50);
    expect(queryResult.coverage_percentage).toBe(95.5);
    expect(queryResult.summary).toBeDefined();

    // Save with fraction coverage <= 1 (e.g. 0.85 -> 85)
    const saveFraction = await testSummaryCommand({
      run: root,
      passed: "10",
      failed: "1",
      coverage: "0.85",
    });
    expect(saveFraction.coverage_percentage).toBe(85);
  });

  test("dispatches test:summary via execute", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-summary-exec-"));
    roots.push(root);

    const saved = await execute(["test:summary", "--run", root, "--passed", "25", "--failed", "0"]);
    expect(saved.saved).toBe(true);

    const queried = await execute(["test:summary", "--run", root]);
    expect(queried.found).toBe(true);
  });
});
