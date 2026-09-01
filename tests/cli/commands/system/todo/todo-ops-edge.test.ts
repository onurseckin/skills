import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { registerSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import type { FeedbackItem } from "../../../../../olt/scripts/src/mind/feedback/queue/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
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
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `todo-edge-${label}-`)));
  roots.push(dir);
  return dir;
}

describe("execute CLI harness integration for queue commands", () => {
  it("executes queue:add, queue:status, queue:drain, queue:seal, and queue:clean via CLI execute harness", async () => {
    const testDir = getTestDir("cli-execute-harness");
    const authorityRun = authorizeMind(testDir);
    const queueFile = join(testDir, "feedback-queue.jsonl");
    const archiveFile = join(testDir, "completed-tasks.jsonl");

    // 1. queue:add
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

    // 2. queue:status
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

    // 3. queue:drain
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

    // 4. queue:seal
    const sealRes = await execute([
      "queue:seal",
      "--authority-run",
      authorityRun,
      "--id",
      addedItem.id,
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

    // 5. queue:clean
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

    // 6. queue:status shows 0 items remaining
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

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies CLI todo-ops test files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      join(process.cwd(), "olt/scripts/src/cli/commands/todo-ops.ts"),
      join(process.cwd(), "olt/scripts/src/cli/registry/todo.ts"),
      join(process.cwd(), "tests/cli/commands/todo/todo-ops-edge.test.ts"),
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
