import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("agent:register", () => {
  test("registers a root agent and reports zero prior active grants", async () => {
    const { run } = await setupCompiledRun("agent-register-root", roots);
    const result = await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    expect(String(result.markdown)).toBeString();
    expect(result.run_root).toBe(run);
    const agent = result.agent as { id: string; role: string; status: string };
    expect(agent.id).toBe("coordinator-1");
    expect(agent.role).toBe("coordinator");
    expect(agent.status).toBe("active");
    expect(result.active_grants).toBe(1);
  });

  test("registers a subagent under a parent, task and full telemetry set", async () => {
    const { run } = await setupCompiledRun("agent-register-sub", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);

    const result = await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-core",
      "--provider",
      "anthropic",
      "--model",
      "claude-x",
      "--model-tier",
      "l",
      "--thinking-level",
      "high",
      "--context-window",
      "200000",
      "--tool",
      "Bash=shell",
      "--tool-extra",
      "Bash:shell=zsh",
    ]);
    const agent = result.agent as {
      id: string;
      parent_agent_id: string | null;
      parent_task_id: string | null;
    };
    expect(agent.id).toBe("worker-1");
    expect(agent.parent_agent_id).toBe("coordinator-1");
    expect(agent.parent_task_id).toBe("task-core");
    expect(result.active_grants).toBe(2);
  });

  test("rejects an unrecognized --role", async () => {
    const { run } = await setupCompiledRun("agent-register-bad-role", roots);
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "not-a-role",
        "--host",
        "claude-code",
      ]),
    ).rejects.toThrow("--role must be one of");
  });

  test("rejects an unrecognized --model-tier", async () => {
    const { run } = await setupCompiledRun("agent-register-bad-tier", roots);
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--model-tier",
        "xxl",
      ]),
    ).rejects.toThrow("--model-tier must be one of");
  });

  test("rejects an unrecognized --thinking-level", async () => {
    const { run } = await setupCompiledRun("agent-register-bad-thinking", roots);
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--thinking-level",
        "extreme",
      ]),
    ).rejects.toThrow("--thinking-level must be one of");
  });
});

describe("agent:report", () => {
  test("ingests tool usage and token counts, replacing the running totals", async () => {
    const { run } = await setupCompiledRun("agent-report", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
    ]);

    const result = await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tool",
      "Read=file-edit",
      "--tool",
      "Grep=search",
      "--tokens-in",
      "18000",
      "--tokens-out",
      "2400",
      "--token-extra",
      "cache_read_input_tokens=91000",
    ]);
    expect(result.run_root).toBe(run);
    const agent = result.agent as { id: string };
    expect(agent.id).toBe("worker-1");
  });

  test("records estimated token counts when --tokens-estimated is given", async () => {
    const { run } = await setupCompiledRun("agent-report-estimated", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
    ]);
    const result = await execute([
      "agent:report",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--tokens-in",
      "500",
      "--tokens-estimated",
    ]);
    expect(result.agent).toBeDefined();
  });
});

describe("agent:release", () => {
  test("closes a grant and reports the remaining active count", async () => {
    const { run } = await setupCompiledRun("agent-release", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
    ]);

    const result = await execute([
      "agent:release",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--reason",
      "task-core submitted",
    ]);
    const agent = result.agent as { id: string; status: string };
    expect(agent.id).toBe("worker-1");
    expect(agent.status).toBe("released");
    expect(result.active_grants).toBe(1);
  });
});

describe("agent:list", () => {
  test("lists active grants by default and excludes released ones", async () => {
    const { run } = await setupCompiledRun("agent-list-active", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
    ]);
    await execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "done"]);

    const active = await execute(["agent:list", "--run", run]);
    expect(active.active_grants).toBe(1);
    expect(active.released_grants).toBe(1);
    const agents = active.agents as { id: string; ancestors: string[] }[];
    expect(agents.map((a) => a.id)).toEqual(["coordinator-1"]);
  });

  test("--all includes released grants and reports each one's ancestor chain", async () => {
    const { run } = await setupCompiledRun("agent-list-all", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
    ]);
    await execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "done"]);

    const all = await execute(["agent:list", "--run", run, "--all"]);
    const agents = all.agents as { id: string; ancestors: string[] }[];
    expect(agents.map((a) => a.id).sort()).toEqual(["coordinator-1", "worker-1"]);
    const worker = agents.find((a) => a.id === "worker-1")!;
    expect(worker.ancestors).toEqual(["coordinator-1"]);
  });

  test("--task reports the lineage of dispatch under that task instead of the roster", async () => {
    const { run } = await setupCompiledRun("agent-list-lineage", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--parent-task",
      "task-core",
    ]);

    const result = await execute(["agent:list", "--run", run, "--task", "task-core"]);
    expect(result.lineage).toBeDefined();
    expect(result.agents).toBeUndefined();
  });
});
