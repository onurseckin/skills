import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import type { JsonObject } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import { initCapsuleRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../../../olt/scripts/src/workflow/agents/grants.ts";
import { stageSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { writeAgentMetadata } from "../../../../../olt/scripts/src/runtime/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

function registerAgentDirect(run: string, agent: string, role: string, parentAgent?: string): void {
  stageSessionGrant({ runRoot: run, agentId: agent, role, host: "antigravity" });
  registerAgentGrant({
    runRoot: run,
    agentId: agent,
    role,
    parentAgentId: parentAgent ?? null,
    parentTaskId: null,
    host: "antigravity",
    authority: parentAgent
      ? { kind: "verified_parent", actorId: parentAgent }
      : { kind: "conditional_genesis" },
    maxAgents: 20,
    telemetry: {},
  });
  const agentTier = (
    role === "mind" ? 0 : role === "orchestrator" ? 1 : role === "coordinator" ? 2 : 3
  ) as 0 | 1 | 2 | 3;
  writeAgentMetadata(
    {
      agent_id: agent,
      role,
      token: `token-${agent}`,
      write_scope: ["tests/core"],
      allowed_read_scope: ["tests/core", "."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
      tools_granted: [],
      tier: agentTier,
      thinking_level: "low",
      registered_at: new Date().toISOString(),
    },
    run,
  );
}

function setupDiagnosticsRun(name: string): { repo: string; run: string } {
  const repo = `/virtual/cli/diag-${name}`;
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  vfs.writeFileSync(join(repo, "package.json"), "{}");
  const { runRoot } = initCapsuleRun(`diag-${name}`, { repo });
  const roster = [
    ["fixture-mind-root", "mind", undefined],
    ["fixture-orch-root", "orchestrator", "fixture-mind-root"],
    ["coordinator", "coordinator", "fixture-orch-root"],
    ["worker-1", "implementer", "coordinator"],
  ] as const;
  for (const [agent, role, parent] of roster) registerAgentDirect(runRoot, agent, role, parent);

  transact(runRoot, "test-setup", "init-diag-state", {}, (draft) => {
    draft.plan = {
      tasks: [{ id: "task-core", label: "Core Unit Tests", scope: "tests/core", status: "ready" }],
    };
    draft.tasks = {
      "task-core": {
        id: "task-core",
        label: "Core Unit Tests",
        status: "ready",
        write_scope: ["tests/core"],
      },
    };
  });
  return { repo, run: runRoot };
}

describe("doctor command", () => {
  test("runs doctor check on a compiled run and returns structured report", async () => {
    const { run } = setupDiagnosticsRun("doctor-basic");
    const result = await execute(["doctor", "--run", run]);
    expect(result.run_root).toBe(run);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("### Capsule Doctor:");
  });

  test("runs doctor:verify to assert invariants", async () => {
    const { run } = setupDiagnosticsRun("doctor-verify");
    const result = await execute(["doctor:verify", "--run", run]);
    expect(result.run_root).toBe(run);
    expect(result.markdown).toBeDefined();
  });

  test("runs doctor:repair to repair projection", async () => {
    const { run } = setupDiagnosticsRun("doctor-repair");
    const result = await execute(["doctor:repair", "--run", run, "--actor", "coordinator"]);
    expect(result.run_root).toBe(run);
    expect(String(result.markdown)).toContain("### Projection Repaired");
  });
});

describe("health command", () => {
  test("runs health command on scripts directory with check filter", async () => {
    const scriptsDir = "/virtual/cli/scripts";
    const vfs = getVirtualCliFS();
    vfs.mkdirSync(join(scriptsDir, "src"), { recursive: true });
    vfs.writeFileSync(join(scriptsDir, "src", "index.ts"), "export const healthy = true;\n");
    const result = await execute([
      "health",
      "--scripts",
      scriptsDir,
      "--check",
      "vendor-identifiers",
    ]);
    expect(result.healthy).toBeDefined();
    expect(result.markdown).toBeDefined();
  });

  test("rejects invalid --check option with known error", async () => {
    const scriptsDir = "/virtual/cli/scripts";
    const vfs = getVirtualCliFS();
    vfs.mkdirSync(join(scriptsDir, "src"), { recursive: true });
    vfs.writeFileSync(join(scriptsDir, "src", "index.ts"), "export const healthy = true;\n");
    await expect(
      execute(["health", "--scripts", scriptsDir, "--check", "invalid-check"]),
    ).rejects.toThrow("unknown --check");
  });
});

describe("recover command", () => {
  test("releases a task lease past its expiry and reclaims stale branch sub-lease", async () => {
    const { run } = setupDiagnosticsRun("recover-stale");
    transact(run, "test-setup", "stale-lease", {}, (draft) => {
      draft.tasks["task-core"]!.status = "leased";
      draft.tasks["task-core"]!.lease = {
        agent_id: "worker-1",
        role: "implementer",
        token: "tok-1",
        expires_at: "2020-01-01T00:00:00.000Z",
        leased_at: "2020-01-01T00:00:00.000Z",
      };
    });

    const result = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(String(result.markdown)).toContain("### Stale Lease Recovery");
    expect(result.recovered).toEqual(["task-core"]);
    expect(result.recovered_sub_tasks).toEqual([]);
    const tasks = result.tasks as JsonObject;
    expect((tasks["task-core"] as JsonObject).status).toBe("retry_ready");
  });

  test("accepts explicit --grace-seconds", async () => {
    const { run } = setupDiagnosticsRun("recover-grace");
    const result = await execute([
      "recover",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(result.recovered).toEqual([]);
  });

  test("reclaims a branch sub-task whose sub-agent's lease has expired", async () => {
    const { run } = setupDiagnosticsRun("recover-sub-lease");
    transact(run, "test-setup", "stale-sub-lease", {}, (draft) => {
      draft.branches = [
        {
          id: "branch-1",
          parent_task_id: "task-core",
          parent_agent_id: "worker-1",
          reason: "Fix parser subtask",
          depth: 1,
          status: "open",
          opened_at: "2020-01-01T00:00:00.000Z",
          sub_tasks: [
            {
              id: "S-1",
              label: "Fix the parser",
              write_scope: ["tests/core/sub"],
              status: "claimed",
              lease: {
                agent_id: "sub-recover",
                token_digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                issued_at: "2020-01-01T00:00:00.000Z",
                expires_at: "2020-01-01T00:00:00.000Z",
                duration_seconds: 600,
              },
            },
          ],
        },
      ];
    });

    const result = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(result.recovered_sub_tasks).toEqual(["S-1"]);
  });
});
