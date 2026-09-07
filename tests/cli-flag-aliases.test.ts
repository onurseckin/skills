import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "./cli/commands/fixtures/full-lifecycle-fixture.ts";

const FIXTURE_DIR = "/virtual/cli/capsules/flag-aliases-test";
const RICH_CAPSULE = "/virtual/cli/capsules/rich-capsule-test";

function setupFixtureCapsule(): void {
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const state = {
    schema: "harness.state",
    version: 1,
    tasks: {
      "task-alpha": {
        id: "task-alpha",
        label: "Alpha Feature Implementation",
        status: "ready",
        priority: 75,
        write_scope: ["src/alpha.ts"],
        dependencies: [],
      },
      "task-beta": {
        id: "task-beta",
        label: "Beta Worker Task",
        status: "leased",
        priority: 50,
        write_scope: ["src/beta.ts"],
        dependencies: ["task-alpha"],
        lease: {
          agent_id: "worker-beta",
          token: "tok-beta-123",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      },
    },
  };

  vfs.writeFileSync(join(FIXTURE_DIR, "state.json"), JSON.stringify(state));

  vfs.mkdirSync(RICH_CAPSULE, { recursive: true });
  const richTasks: Record<string, unknown> = {};
  for (let i = 1; i <= 8; i++) {
    richTasks[`task-${i}`] = {
      id: `task-${i}`,
      label: `Rich Task ${i}`,
      status: i === 1 ? "ready" : "leased",
      priority: 50,
      write_scope: [`src/task-${i}.ts`],
      dependencies: [],
    };
  }
  vfs.writeFileSync(
    join(RICH_CAPSULE, "state.json"),
    JSON.stringify({ schema: "harness.state", version: 1, tasks: richTasks }),
  );

  vfs.mkdirSync("/virtual/cli/src", { recursive: true });
  vfs.writeFileSync("/virtual/cli/src/dummy.ts", "export const value = 42;\n");
}

describe("CLI flag aliasing and task:list --run support", () => {
  beforeAll(() => {
    setupVirtualCliFS();
    setupFixtureCapsule();
  });

  afterAll(() => {
    cleanupVirtualCliFS();
  });

  test("task:list accepts --run and returns capsule tasks nicely formatted", async () => {
    const result = await execute(["task:list", "--run", FIXTURE_DIR]);
    expect(result).toBeDefined();
    expect(result.tasks).toBeDefined();
    expect(Array.isArray(result.tasks)).toBe(true);
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(2);
    expect(tasks.some((t) => t.id === "task-alpha")).toBe(true);
    expect(tasks.some((t) => t.id === "task-beta")).toBe(true);
    expect(typeof result.markdown).toBe("string");
    expect((result.markdown as string).includes("Alpha Feature Implementation")).toBe(true);
    expect((result.markdown as string).includes("Beta Worker Task")).toBe(true);
  });

  test("task:list accepts --capsule as an alias for --run", async () => {
    const result = await execute(["task:list", "--capsule", FIXTURE_DIR]);
    expect(result).toBeDefined();
    expect(result.tasks).toBeDefined();
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(2);
    expect(tasks[0].id).toBe("task-alpha");
  });

  test("task:list filters tasks by status when --run is provided", async () => {
    const readyResult = await execute(["task:list", "--run", FIXTURE_DIR, "--status", "ready"]);
    const readyTasks = readyResult.tasks as Record<string, unknown>[];
    expect(readyTasks.length).toBe(1);
    expect(readyTasks[0].id).toBe("task-alpha");

    const leasedResult = await execute(["task:list", "--run", FIXTURE_DIR, "--status", "leased"]);
    const leasedTasks = leasedResult.tasks as Record<string, unknown>[];
    expect(leasedTasks.length).toBe(1);
    expect(leasedTasks[0].id).toBe("task-beta");
  });

  test("task:list normalizes --agent to --agent-id filter", async () => {
    const result = await execute(["task:list", "--run", FIXTURE_DIR, "--agent", "worker-beta"]);
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe("task-beta");
  });

  test("task:list supports search filtering", async () => {
    const result = await execute(["task:list", "--run", FIXTURE_DIR, "--search", "Alpha"]);
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe("task-alpha");
  });

  test("universal alias --capsule normalizes to --run on commands declaring run", async () => {
    const result = await execute(["task:list", "--capsule", RICH_CAPSULE]);
    expect(result).toBeDefined();
    expect(result.tasks).toBeDefined();
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBe(8);
  });

  test("universal alias --agent normalizes to --actor on task:check", async () => {
    const result = await execute([
      "task:check",
      "--agent",
      "auditor-1",
      "--lint",
      "--file",
      "/virtual/cli/src/dummy.ts",
    ]);
    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });

  test("universal alias rejects unknown options when command does not accept actor/agent", async () => {
    let thrownError: HarnessError | undefined;
    try {
      await execute(["plan:init", "--repo", "/virtual/cli", "--run", "x", "--actor", "planner"]);
    } catch (err: unknown) {
      if (err instanceof HarnessError) thrownError = err;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe("unknown option: --actor");
  });

  test("derives queue-path when --run is provided to queue commands", async () => {
    const vfs = getVirtualCliFS();
    const dummyQueueFile = join(FIXTURE_DIR, "tasks.jsonl");
    vfs.writeFileSync(dummyQueueFile, "");
    const result = await execute(["task:prune", "--run", FIXTURE_DIR]);
    expect(result).toBeDefined();
    expect(typeof result.prunedCount).toBe("number");
  });

  test("task:list works with rich capsule", async () => {
    const result = await execute(["task:list", "--run", RICH_CAPSULE]);
    expect(result).toBeDefined();
    const tasks = result.tasks as Record<string, unknown>[];
    expect(tasks.length).toBeGreaterThanOrEqual(7);
    expect(tasks.some((t) => t.id === "task-4")).toBe(true);
    expect((result.markdown as string).includes("task-4")).toBe(true);
  });
});
