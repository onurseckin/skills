import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanStaleTempFiles,
  clearTaskQueue,
  loadTaskQueue,
  saveTaskQueue,
  withTaskQueueLock,
  type TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";
import { cleanupVirtualTaskFS, scratchRoot, setupVirtualTaskFS } from "../task-fixture.ts";

function createMockTask(id: string, title = "Test Task"): TaskQueueItem {
  return {
    id,
    title,
    description: "Task description",
    priority: "HIGH",
    status: "PENDING",
    write_scope: [`src/${id}.ts`],
    gate: "bun test",
    charter_goals: ["G1"],
    acceptance_criteria: ["Must pass all gates"],
    dependencies: [],
    blocked_by: [],
    lease: null,
    source_type: "self_evolution",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    retry_count: 0,
    max_retries: 3,
  };
}

describe("Task Queue Storage and Locking (task-storage.test.ts)", () => {
  beforeEach(() => {
    setupVirtualTaskFS();
  });

  afterEach(() => {
    cleanupVirtualTaskFS();
  });
  test("loadTaskQueue returns empty array when file does not exist", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const nonExistentPath = join(sandbox, "missing.jsonl");
    const tasks = loadTaskQueue(nonExistentPath);
    expect(tasks).toEqual([]);
  });

  test("saveTaskQueue writes tasks atomically and loadTaskQueue deserializes accurately", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const queueFile = join(sandbox, "tasks.jsonl");

    const t1 = createMockTask("task-1", "Task 1");
    const t2 = createMockTask("task-2", "Task 2");

    saveTaskQueue([t1, t2], queueFile);

    expect(existsSync(queueFile)).toBe(true);
    const loaded = loadTaskQueue(queueFile);
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.id).toBe("task-1");
    expect(loaded[0]!.title).toBe("Task 1");
    expect(loaded[0]!.write_scope).toEqual(["src/task-1.ts"]);
    expect(loaded[1]!.id).toBe("task-2");
    expect(loaded[1]!.title).toBe("Task 2");
  });

  test("clearTaskQueue resets queue to empty file", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const queueFile = join(sandbox, "tasks.jsonl");

    saveTaskQueue([createMockTask("task-1")], queueFile);
    expect(loadTaskQueue(queueFile).length).toBe(1);

    clearTaskQueue(queueFile);
    expect(loadTaskQueue(queueFile)).toEqual([]);
    expect(readFileSync(queueFile, "utf8")).toBe("");
  });

  test("loadTaskQueue throws INTEGRITY error on corrupted JSONL line", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const queueFile = join(sandbox, "corrupt.jsonl");

    writeFileSync(queueFile, "{ not valid json }\n", "utf8");
    expect(() => loadTaskQueue(queueFile)).toThrow(HarnessError);
    try {
      loadTaskQueue(queueFile);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INTEGRITY");
    }
  });

  test("loadTaskQueue throws INTEGRITY on symlink queue file", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const targetFile = join(sandbox, "real-target.jsonl");
    const symlinkFile = join(sandbox, "symlink.jsonl");

    writeFileSync(targetFile, "{}\n", "utf8");
    symlinkSync(targetFile, symlinkFile);

    expect(() => loadTaskQueue(symlinkFile)).toThrow(HarnessError);
    try {
      loadTaskQueue(symlinkFile);
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INTEGRITY");
    }
  });

  test("loadTaskQueue throws INTEGRITY on hardlink queue file", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const original = join(sandbox, "original.jsonl");
    const hardlink = join(sandbox, "hardlink.jsonl");

    writeFileSync(original, "{}\n", "utf8");
    linkSync(original, hardlink);

    expect(() => loadTaskQueue(original)).toThrow(HarnessError);
    expect(() => loadTaskQueue(hardlink)).toThrow(HarnessError);
  });

  test("cleanStaleTempFiles removes matching temp files older than maxAgeMs and preserves fresh files", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    mkdirSync(sandbox, { recursive: true });

    const stale1 = join(sandbox, ".task-queue.12345.abc123tmp.tmp");
    const stale2 = join(sandbox, ".task-queue.67890.def456tmp.tmp");
    const fresh = join(sandbox, ".task-queue.99999.fresh123.tmp");
    const nonMatching = join(sandbox, "other-temp-file.tmp");

    writeFileSync(stale1, "stale content 1", "utf8");
    writeFileSync(stale2, "stale content 2", "utf8");
    writeFileSync(fresh, "fresh content", "utf8");
    writeFileSync(nonMatching, "other file", "utf8");

    const pastTime = (Date.now() - 120_000) / 1000;
    utimesSync(stale1, pastTime, pastTime);
    utimesSync(stale2, pastTime, pastTime);

    const cleaned = cleanStaleTempFiles(sandbox, 60_000);
    expect(cleaned).toBe(2);
    expect(existsSync(stale1)).toBe(false);
    expect(existsSync(stale2)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(nonMatching)).toBe(true);
  });

  test("cleanStaleTempFiles returns 0 for non-existent directory", () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const nonExistent = join(sandbox, "does-not-exist-dir");
    expect(cleanStaleTempFiles(nonExistent)).toBe(0);
  });

  test("withTaskQueueLock executes sync and async mutations cleanly", async () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const queueFile = join(sandbox, "tasks.jsonl");

    const syncResult = await withTaskQueueLock(queueFile, () => {
      saveTaskQueue([createMockTask("task-sync")], queueFile);
      return "sync-done";
    });
    expect(syncResult).toBe("sync-done");
    expect(loadTaskQueue(queueFile).length).toBe(1);

    const asyncResult = await withTaskQueueLock(queueFile, async () => {
      await new Promise((res) => setTimeout(res, 10));
      saveTaskQueue([createMockTask("task-async")], queueFile);
      return "async-done";
    });
    expect(asyncResult).toBe("async-done");
    expect(loadTaskQueue(queueFile)[0]!.id).toBe("task-async");
  });

  test("withTaskQueueLock releases lock cleanly when callback throws", async () => {
    const sandbox = scratchRoot(import.meta.path, "storage");
    const queueFile = join(sandbox, "tasks.jsonl");

    let caughtError: unknown;
    try {
      await withTaskQueueLock(queueFile, () => {
        throw new Error("intentional mutation failure");
      });
    } catch (err) {
      caughtError = err;
    }
    expect(caughtError).toBeDefined();

    const afterResult = await withTaskQueueLock(queueFile, () => "recovered");
    expect(afterResult).toBe("recovered");
  });
});
