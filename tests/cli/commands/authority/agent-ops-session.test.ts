import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
} from "../../../../olt/scripts/src/authority/session/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  clearCallerSession();
  await cleanupRoots(roots);
});

function installCallerSession(run: string, agentId: string, role: string): void {
  registerSessionGrant({ runRoot: run, agentId, role, host: "claude-code" });
}

function clearCallerSession(run?: string, agentId = "coordinator-1"): void {
  revokeSessionGrant({ runRoot: run, agentId, pid: process.pid, ppid: process.ppid });
  if (run) revokeSessionGrant({ agentId, pid: process.pid, ppid: process.ppid });
}

async function registerCoordAndWorker(run: string, parentTask?: string): Promise<void> {
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
  installCallerSession(run, "coordinator-1", "coordinator");
  const args = [
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
    "--actor",
    "coordinator-1",
  ];
  if (parentTask) args.push("--parent-task", parentTask);
  await execute(args);
}

describe("agent:release", () => {
  test("closes a grant and reports the remaining active count", async () => {
    const { run } = await setupCompiledRun("agent-release", roots);
    await registerCoordAndWorker(run);

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

  test("denies a caller from releasing an unrelated target but permits its active direct parent", async () => {
    const { run } = await setupCompiledRun("agent-release-caller-binding", roots);
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
      "--actor",
      "coordinator-1",
    ]);
    installCallerSession(run, "coordinator-1", "coordinator");
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "worker-2",
      "--role",
      "implementer",
      "--host",
      "claude-code",
      "--parent-agent",
      "coordinator-1",
      "--actor",
      "coordinator-1",
    ]);
    installCallerSession(run, "worker-1", "implementer");
    await expect(
      execute(["agent:release", "--run", run, "--agent", "coordinator-1", "--reason", "no"]),
    ).rejects.toThrow("authenticated caller");
    await expect(
      execute(["agent:release", "--run", run, "--agent", "worker-2", "--reason", "no"]),
    ).rejects.toThrow("authenticated caller");

    installCallerSession(run, "coordinator-1", "coordinator");
    await expect(
      execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "done"]),
    ).resolves.toMatchObject({ active_grants: 2 });
  });

  test("refuses an explicit identity claim without a registered caller session", async () => {
    const { run } = await setupCompiledRun("agent-release-no-session", roots);
    clearCallerSession(run);
    const before = JSON.stringify(loadRun(run));
    await expect(
      execute([
        "agent:release",
        "--run",
        run,
        "--agent",
        "someone-else",
        "--actor",
        "someone-else",
        "--reason",
        "no-session",
      ]),
    ).rejects.toThrow("verified caller");
    expect(JSON.stringify(loadRun(run))).toBe(before);
  });
});

describe("agent:list", () => {
  test("lists active grants by default and excludes released ones", async () => {
    const { run } = await setupCompiledRun("agent-list-active", roots);
    await registerCoordAndWorker(run);
    await execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "done"]);

    const active = await execute(["agent:list", "--run", run]);
    expect(active.active_grants).toBe(1);
    expect(active.released_grants).toBe(1);
    const agents = active.agents as { id: string; ancestors: string[] }[];
    expect(agents.map((a) => a.id)).toEqual(["coordinator-1"]);
  });

  test("--all includes released grants and reports each one's ancestor chain", async () => {
    const { run } = await setupCompiledRun("agent-list-all", roots);
    await registerCoordAndWorker(run);
    await execute(["agent:release", "--run", run, "--agent", "worker-1", "--reason", "done"]);

    const all = await execute(["agent:list", "--run", run, "--all"]);
    const agents = all.agents as { id: string; ancestors: string[] }[];
    expect(agents.map((a) => a.id).sort()).toEqual(["coordinator-1", "worker-1"]);
    const worker = agents.find((a) => a.id === "worker-1")!;
    expect(worker.ancestors).toEqual(["coordinator-1"]);
  });

  test("--task reports the lineage of dispatch under that task instead of the roster", async () => {
    const { run } = await setupCompiledRun("agent-list-lineage", roots);
    await registerCoordAndWorker(run, "task-core");

    const result = await execute(["agent:list", "--run", run, "--task", "task-core"]);
    expect(result.lineage).toBeDefined();
    expect(result.agents).toBeUndefined();
  });
});
