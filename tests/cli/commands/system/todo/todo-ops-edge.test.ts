import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { registerSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function authorizeMind(repo: string): string {
  const run = initRun(repo, "todo-authority", new TextEncoder().encode("prompt"), "file", true);
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id: "mind",
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status: "active",
      },
    ];
  });
  registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
  return run;
}

function getTestDir(label: string): string {
  const dir = `/virtual/cli/todo-edge-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(dir, { recursive: true });
  vfs.mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

describe("execute CLI harness integration for queue commands", () => {
  it("executes queue:add and queue:status intake and inspection stage", async () => {
    const testDir = getTestDir("cli-intake");
    const queueFile = join(testDir, "feedback-queue.jsonl");

    const addRes = await execute([
      "queue:add",
      "--title",
      "Harness Dispatched Item",
      "--content",
      "Dispatched via CLI execute",
      "--priority",
      "CRITICAL",
      "--category",
      "CORE_ENGINE",
      "--queue-file",
      queueFile,
    ]);
    expect(addRes["item"]).toBeDefined();
    const addedItem = addRes["item"] as FeedbackItem;
    expect(addedItem.title).toBe("Harness Dispatched Item");
    expect(addedItem.priority).toBe("CRITICAL_USER_FEEDBACK");

    const listRes = await execute([
      "queue:status",
      "--status",
      "PENDING",
      "--all",
      "--queue-file",
      queueFile,
    ]);
    expect(listRes["count"]).toBe(1);
    expect(listRes["total"]).toBe(1);
  });

  it("executes queue:drain processing stage", async () => {
    const testDir = getTestDir("cli-drain");
    const authorityRun = authorizeMind(testDir);
    const queueFile = join(testDir, "feedback-queue.jsonl");

    writeFeedbackQueue(
      [
        {
          id: "item-proc-1",
          timestamp: new Date().toISOString(),
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Harness Dispatched Item",
          content: "Dispatched via CLI execute",
        },
      ],
      queueFile,
    );

    const drainRes = await execute([
      "queue:drain",
      "--authority-run",
      authorityRun,
      "--limit",
      "1",
      "--mark-as",
      "PROCESSED",
      "--queue-file",
      queueFile,
    ]);
    expect(drainRes["drainedCount"]).toBe(1);
  });

  it("executes queue:seal verification stage", async () => {
    const testDir = getTestDir("cli-seal");
    const authorityRun = authorizeMind(testDir);
    const queueFile = join(testDir, "feedback-queue.jsonl");

    writeFeedbackQueue(
      [
        {
          id: "item-proc-1",
          timestamp: new Date().toISOString(),
          priority: "CRITICAL_USER_FEEDBACK",
          status: "PROCESSED",
          category: "CORE_ENGINE",
          title: "Harness Dispatched Item",
          content: "Dispatched via CLI execute",
        },
      ],
      queueFile,
    );

    const sealRes = await execute([
      "queue:seal",
      "--authority-run",
      authorityRun,
      "--id",
      "item-proc-1",
      "--resolution",
      "Empirical proof verified",
      "--commit",
      "abcdef123456",
      "--test-path",
      "tests/cli/commands/todo/todo-ops-edge.test.ts",
      "--assertions",
      "10",
      "--runtime-ms",
      "50",
      "--queue-file",
      queueFile,
    ]);
    expect(sealRes["sealed"]).toBe(true);
  });

  it("executes queue:clean and verifies archival pruning stage", async () => {
    const testDir = getTestDir("cli-archival");
    const authorityRun = authorizeMind(testDir);
    const queueFile = join(testDir, "feedback-queue.jsonl");
    const archiveFile = join(testDir, "completed-tasks.jsonl");

    writeFeedbackQueue(
      [
        {
          id: "item-clean-1",
          timestamp: new Date().toISOString(),
          priority: "CRITICAL_USER_FEEDBACK",
          status: "COMPLETED",
          category: "CORE_ENGINE",
          title: "Harness Dispatched Item",
          content: "Dispatched via CLI execute",
        },
      ],
      queueFile,
    );

    const cleanRes = await execute([
      "queue:clean",
      "--authority-run",
      authorityRun,
      "--queue-file",
      queueFile,
      "--archive-file",
      archiveFile,
    ]);
    expect(cleanRes["cleanedCount"]).toBe(1);
    expect(cleanRes["remainingCount"]).toBe(0);

    const listEmpty = await execute(["queue:status", "--queue-file", queueFile]);
    expect(listEmpty["count"]).toBe(0);
  });

  it("rejects retired aliases through execute", async () => {
    const testDir = getTestDir("cli-aliases");
    const queueFile = join(testDir, "feedback-queue.jsonl");

    await expect(execute(["feedback:ingest", "--queue-file", queueFile])).rejects.toThrow(
      "unknown command: feedback:ingest",
    );
    await expect(execute(["feedback:list", "--queue-file", queueFile])).rejects.toThrow(
      "unknown command: feedback:list",
    );
    await expect(execute(["feedback:drain", "--queue-file", queueFile])).rejects.toThrow(
      "unknown command: feedback:drain",
    );
    await expect(execute(["todo:list", "--queue-file", queueFile])).rejects.toThrow(
      "unknown command: todo:list",
    );
    await expect(execute(["mind:queue:add", "--queue-file", queueFile])).rejects.toThrow(
      "unknown command: mind:queue:add",
    );
  });
});
