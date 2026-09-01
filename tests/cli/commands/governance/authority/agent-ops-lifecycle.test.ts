import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
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

describe("agent:register - Hierarchy & Report", () => {
  test("agent:register authenticates an omitted actor from the caller session before applying hierarchy policy", async () => {
    const { run } = await setupCompiledRun("agent-register-e2e-hierarchy", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "orchestrator-1",
      "--role",
      "orchestrator",
      "--host",
      "claude-code",
    ]);
    installCallerSession(run, "orchestrator-1", "orchestrator");

    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "impl-skip-tier",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "orchestrator-1",
      ]),
    ).rejects.toThrow("may only dispatch Tier 2 Coordinators");

    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "impl-skip-tier",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "orchestrator-1",
        "--actor",
        "orchestrator-1",
      ]),
    ).rejects.toThrow("may only dispatch Tier 2 Coordinators");

    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "impl-ghost-parent",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "no-such-agent",
      ]),
    ).rejects.toThrow("does not resolve to any grant");
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
    installCallerSession(run, "worker-1", "implementer");

    const result = await execute([
      "agent:report",
      "--run-id",
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

  test("authorizes report against the authenticated caller, not the named target", async () => {
    const { run } = await setupCompiledRun("agent-report-caller-binding", roots);
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
    installCallerSession(run, "worker-1", "implementer");

    await expect(
      execute([
        "agent:report",
        "--run",
        run,
        "--agent",
        "coordinator-1",
        "--tool",
        "Read=file-edit",
      ]),
    ).rejects.toThrow("authenticated caller");
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
    installCallerSession(run, "worker-1", "implementer");
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
