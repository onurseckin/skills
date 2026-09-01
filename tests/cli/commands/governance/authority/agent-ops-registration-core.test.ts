import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { agentRegisterCommand } from "../../../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { loadRun } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
  resolveActiveSession,
} from "../../../../../olt/scripts/src/authority/session/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

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

function registrationBytes(run: string, agentId: string): Record<string, string | null> {
  const sessionPath = join(run, "runtime", "sessions", `${agentId}.json`);
  return {
    events: readFileSync(join(run, "events.jsonl"), "utf8"),
    state: readFileSync(join(run, "state.json"), "utf8"),
    session: existsSync(sessionPath) ? readFileSync(sessionPath, "utf8") : null,
  };
}

describe("agent:register - Core Registration", () => {
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
    expect(existsSync(join(run, "runtime", "sessions", "coordinator-1.json"))).toBe(true);
  });

  test("keeps staged session and makes retry idempotent when grant commits before index refresh", async () => {
    const { run } = await setupCompiledRun("agent-register-committed-pending", roots);
    const eventCountBefore = loadRun(run).events.length;
    rmSync(join(run, "index.json"));
    mkdirSync(join(run, "index.json"));
    const flags = { run, agent: "coordinator-1", role: "coordinator", host: "claude-code" };
    const pending = agentRegisterCommand(flags);
    expect(pending.transaction_status).toBe("committed_with_recovery_pending");
    expect(pending.active_grants).toBe(1);
    rmSync(join(run, "index.json"), { recursive: true });
    const retried = agentRegisterCommand(flags);
    expect(retried.transaction_status).toBe("committed_recovered");
    expect(retried.active_grants).toBe(1);
    expect(loadRun(run).events).toHaveLength(eventCountBefore + 1);
    expect(existsSync(join(run, "runtime", "sessions", "coordinator-1.json"))).toBe(true);
  });

  test("rolls back conditionally staged session when locked ledger is nonempty", async () => {
    const { run } = await setupCompiledRun("agent-register-conditional-rollback", roots);
    agentRegisterCommand({
      run,
      agent: "coordinator-1",
      role: "coordinator",
      host: "claude-code",
      pid: String(process.pid),
      ppid: String(process.ppid),
    });
    const before = registrationBytes(run, "worker-rejected");

    expect(() =>
      agentRegisterCommand({
        run,
        agent: "worker-rejected",
        role: "implementer",
        host: "claude-code",
        "parent-agent": "coordinator-1",
      }),
    ).toThrow("conditional agent genesis");
    expect(registrationBytes(run, "worker-rejected")).toEqual(before);
    expect(resolveActiveSession({ runRoot: run })?.agent_id).toBe("coordinator-1");
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
    installCallerSession(run, "coordinator-1", "coordinator");

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
      "--actor",
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
    expect(existsSync(join(run, "runtime", "sessions", "worker-1.json"))).toBe(true);
  });
});
