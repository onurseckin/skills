import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  todoAddCommand,
  todoCleanCommand,
  todoDrainCommand,
  todoSealCommand,
} from "../../../../../olt/scripts/src/cli/commands/todo/index.ts";
import { readFeedbackQueue } from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readCompletedTasksLedger } from "../../../../../olt/scripts/src/mind/archival/completed/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function getTestDir(lbl: string): string {
  const d = `/virtual/cli/todo-c-${lbl}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  getVirtualCliFS().mkdirSync(d, { recursive: true });
  roots.push(d);
  return d;
}

describe("todo-ops seal and clean operations", () => {
  it("todoSealCommand seals items with proof and enforces requirements", () => {
    const qFile = join(getTestDir("seal-ops"), "feedback-queue.jsonl");
    todoAddCommand({ id: "s1", title: "Task 1", content: "Content", "queue-file": qFile });
    todoAddCommand({ id: "s2", title: "Task 2", content: "Content", "queue-file": qFile });
    todoAddCommand({ id: "s3", title: "Task 3", content: "Content", "queue-file": qFile });

    const seal1 = todoSealCommand({
      id: "s1",
      resolution: "Fixed issue",
      commit: "abc1234",
      "test-path": "tests/test.ts",
      assertions: "5",
      "runtime-ms": "12",
      "queue-path": qFile,
    });
    expect(seal1.sealed).toBe(true);
    expect(seal1.item.commit_sha).toBe("abc1234");
    expect(seal1.item.test_path).toBe("tests/test.ts");
    expect(seal1.item.assertions).toBe(5);
    expect(seal1.item.runtime_ms).toBe(12);
    expect(seal1.markdown).toContain("Mind Queue Item Sealed");

    const seal2 = todoSealCommand({
      id: "s2",
      note: "Note res",
      "commit-sha": "def5678",
      "queue-file": qFile,
    });
    expect(seal2.item.resolution_note).toBe("Note res");

    const seal3 = todoSealCommand({ id: "s3", summary: "Summary res", "queue-file": qFile });
    expect(seal3.item.resolution_note).toBe("Summary res");

    expect(() =>
      todoSealCommand({
        id: "s3",
        resolution: "Fail commit",
        "require-commit-sha": true,
        "queue-file": qFile,
      }),
    ).toThrow();
    expect(() =>
      todoSealCommand({
        id: "s3",
        resolution: "Fail test-path",
        commit: "12345",
        "require-test-path": true,
        "queue-file": qFile,
      }),
    ).toThrow();
  });

  it("todoCleanCommand handles dry-run and commits archived records", () => {
    const qFile = join(getTestDir("clean-ops"), "feedback-queue.jsonl");
    const aFile = join(getTestDir("clean-arch"), "completed-tasks.jsonl");

    const emptyClean = todoCleanCommand({ "queue-file": qFile, "archive-file": aFile });
    expect(emptyClean.cleanedCount).toBe(0);
    expect(emptyClean.remainingCount).toBe(0);

    todoAddCommand({
      id: "t1",
      title: "Very Long Clean Title Exceeding Thirty-Five Characters",
      content: "C1",
      category: "CLI_TOOLING",
      "queue-file": qFile,
    });
    todoAddCommand({
      id: "t2",
      title: "Declined Item",
      content: "C2",
      category: "CORE_ENGINE",
      "queue-file": qFile,
    });
    todoAddCommand({
      id: "t3",
      title: "Pending Item",
      content: "C3",
      category: "ARCHITECTURE",
      "queue-file": qFile,
    });

    todoSealCommand({
      id: "t1",
      resolution: "Resolved t1",
      commit: "hash123",
      "test-path": "tests/t1.test.ts",
      assertions: "3",
      "runtime-ms": "50",
      "queue-file": qFile,
    });
    todoDrainCommand({ category: "CORE_ENGINE", "mark-as": "DECLINED", "queue-file": qFile });

    const dryRes = todoCleanCommand({
      "queue-file": qFile,
      "archive-file": aFile,
      "dry-run": true,
    });
    expect(dryRes.dryRun).toBe(true);
    expect(dryRes.cleanedCount).toBe(2);
    expect(dryRes.remainingCount).toBe(1);
    expect(dryRes.markdown).toContain("DRY RUN (no changes written)");
    expect(readFeedbackQueue(qFile)).toHaveLength(3);

    const commitRes = todoCleanCommand({ "queue-path": qFile, "archive-file": aFile });
    expect(commitRes.dryRun).toBe(false);
    expect(commitRes.cleanedCount).toBe(2);
    expect(commitRes.remainingCount).toBe(1);
    expect(commitRes.markdown).toContain("COMMITTED");
    expect(readFeedbackQueue(qFile)).toHaveLength(1);

    const ledger = readCompletedTasksLedger(aFile);
    expect(ledger).toHaveLength(2);
    const archived1 = ledger.find((r) => r.id === "t1");
    expect(archived1?.status).toBe("COMPLETED");
    expect(archived1?.commit_sha).toBe("hash123");
    expect(archived1?.test_path).toBe("tests/t1.test.ts");
    expect(archived1?.assertions).toBe(3);
    expect(archived1?.runtime_ms).toBe(50);
    expect(ledger.find((r) => r.id === "t2")?.status).toBe("RESOLVED");
  });
});
