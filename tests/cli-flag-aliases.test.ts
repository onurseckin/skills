import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../olt/scripts/src/core/errors/index.ts";

const FIXTURE_DIR = join(process.cwd(), ".tmp", `flag-aliases-test-${Date.now()}`);
const LIVE_CAPSULE =
  "/Users/onurseckinsenoglu/repos/skills/.olt/capsules/olt-forensics-and-hardening";

function setupFixtureCapsule(): string {
  if (!existsSync(FIXTURE_DIR)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  }
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

  writeFileSync(join(FIXTURE_DIR, "state.json"), JSON.stringify(state), "utf-8");
  return FIXTURE_DIR;
}

describe("CLI flag aliasing and task:list --run support", () => {
  beforeAll(() => {
    setupFixtureCapsule();
  });

  afterAll(() => {
    try {
      if (existsSync(FIXTURE_DIR)) {
        rmSync(FIXTURE_DIR, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
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
    if (existsSync(LIVE_CAPSULE)) {
      const result = await execute(["task:brief", "--capsule", LIVE_CAPSULE, "--task", "task-4"]);
      expect(result).toBeDefined();
      expect(typeof result.markdown).toBe("string");
      expect((result.markdown as string).includes("task-4")).toBe(true);
    } else {
      const result = await execute(["task:list", "--capsule", FIXTURE_DIR]);
      expect(result.tasks).toBeDefined();
    }
  });

  test("universal alias --agent normalizes to --actor on task:check", async () => {
    const result = await execute([
      "task:check",
      "--agent",
      "auditor-1",
      "--lint",
      "--file",
      "olt/scripts/src/cli/execute.ts",
    ]);
    expect(result).toBeDefined();
    expect(result.passed).toBe(true);
  });

  test("universal alias rejects unknown options when command does not accept actor/agent", async () => {
    let thrownError: HarnessError | undefined;
    try {
      await execute(["plan:init", "--repo", ".", "--run", "x", "--actor", "planner"]);
    } catch (err: unknown) {
      if (err instanceof HarnessError) thrownError = err;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError?.message).toBe("unknown option: --actor");
  });

  test("derives queue-path when --run is provided to queue commands", async () => {
    const dummyQueueFile = join(FIXTURE_DIR, "tasks.jsonl");
    writeFileSync(dummyQueueFile, "", "utf-8");
    const result = await execute(["task:prune", "--run", FIXTURE_DIR]);
    expect(result).toBeDefined();
    expect(typeof result.prunedCount).toBe("number");
  });

  test("task:list works with live capsule if available", async () => {
    if (existsSync(LIVE_CAPSULE)) {
      const result = await execute(["task:list", "--run", LIVE_CAPSULE]);
      expect(result).toBeDefined();
      const tasks = result.tasks as Record<string, unknown>[];
      expect(tasks.length).toBeGreaterThanOrEqual(7);
      expect(tasks.some((t) => t.id === "task-4")).toBe(true);
      expect((result.markdown as string).includes("task-4")).toBe(true);
    }
  });
});
