import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { taskReviewCommand } from "../../../../../olt/scripts/src/cli/commands/task-review.ts";
import { criticReviewCommand } from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

const setupTestCapsule = async (): Promise<{
  runPath: string;
  taskId: string;
  validatorToken: string;
  checkId: string;
}> => {
  const testDir = `/virtual/cli/test-rubber-stamp-${Math.random().toString(36).slice(2)}`;
  roots.push(testDir);
  mkdirSync(testDir, { recursive: true });
  mkdirSync(join(testDir, ".git"), { recursive: true });
  writeFileSync(join(testDir, ".gitignore"), ".capsules/\n.olt/\nscreenshots/\n");
  writeFileSync(join(testDir, "README.md"), "# Test\n");

  const promptBytes = new TextEncoder().encode("Test prompt");
  const runRoot = initRun(testDir, "test-run", promptBytes, "file", true);

  const token = "mock-validation-token-12345678";
  const taskId = "task-ui-01";

  transact(runRoot, "setup", "state-init", {}, (draft) => {
    draft.tasks = {
      [taskId]: {
        id: taskId,
        label: "Build accessible UI card component",
        lane: 0,
        requirement_ids: [],
        dependencies: [],
        write_scope: ["src/components/Card.tsx"],
        status: "validating",
      },
    };
    return draft;
  });

  return {
    runPath: runRoot,
    taskId,
    validatorToken: token,
    checkId: "cmd-check-1",
  };
};

describe("task:review & critic:review - Rubber-Stamp Rejections", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  it("taskReviewCommand rejects rubber-stamp and generic sign-off summaries", async () => {
    const { runPath, taskId, validatorToken, checkId } = await setupTestCapsule();
    const genericSummaries = [
      "looks good",
      "lgtm",
      "all good",
      "passed",
      "pass",
      "ok",
      "fine",
      "done",
      "approved",
      "verified",
      "no issues",
      "all tests pass",
      "rubber stamp",
      "n/a",
      "none",
      "short",
    ];

    for (const summary of genericSummaries) {
      let threw = false;
      try {
        await taskReviewCommand({
          run: runPath,
          task: taskId,
          validator: "val-01",
          token: validatorToken,
          status: "pass",
          checks: checkId,
          summary,
        });
      } catch (err) {
        threw = true;
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_ARGUMENT");
        expect(harnessErr.message).toContain(
          "validator summary cannot be a superficial rubber-stamp",
        );
      }
      expect(threw).toBe(true);
    }
  }, 30_000);

  it("criticReviewCommand rejects rubber-stamp and generic sign-off summaries", async () => {
    const { runPath } = await setupTestCapsule();
    const genericSummaries = [
      "looks good",
      "lgtm",
      "all good",
      "approved",
      "approve",
      "done",
      "ok",
      "fine",
      "pass",
      "passed",
      "everything passed",
      "all requirements met",
      "verified",
      "rubber stamp",
      "n/a",
      "none",
      "short string",
    ];

    for (const summary of genericSummaries) {
      let threw = false;
      try {
        await criticReviewCommand({
          run: runPath,
          critic: "critic-01",
          token: "mock-token",
          decision: "approve",
          summary,
        });
      } catch (err) {
        threw = true;
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_ARGUMENT");
        expect(harnessErr.message).toContain("critic summary cannot be a superficial rubber-stamp");
      }
      expect(threw).toBe(true);
    }
  }, 30_000);
});
