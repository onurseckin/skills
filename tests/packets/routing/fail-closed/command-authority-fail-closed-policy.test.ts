import { describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  assertGrantedCommand as assertRawGrantedCommand,
  assertSpawnAuthorized,
  type AuthenticatedCaller,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import {
  GRANT_BOOTSTRAP_ALLOWLIST,
  PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
  requiresActingIdentity,
} from "../../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import type { AgentRole } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
} from "../../../../olt/scripts/src/authority/session/index.ts";
import { loadDagSnapshot } from "../../../../olt/scripts/src/telemetry/dag-snapshot.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

function testCaller(specification: CommandSpec, flags: Flags): AuthenticatedCaller | undefined {
  const callerFlag = ["actor", "validator", "critic", "agent"].find((name) => {
    if (
      (specification.name === "agent:register" ||
        specification.name === "agent:report" ||
        specification.name === "agent:release") &&
      name === "agent"
    ) {
      return false;
    }
    return typeof flags[name] === "string" && flags[name].trim() !== "";
  });
  if (callerFlag === undefined) return undefined;
  return { actor: flags[callerFlag] as string, role: "test", verified: true };
}

function assertGrantedCommand(specification: CommandSpec, flags: Flags): void {
  assertRawGrantedCommand(specification, flags, testCaller(specification, flags));
}

function installMetaAuditGrant(
  run: string,
  id: string,
  role: string,
  status: "active" | "released" = "active",
): void {
  transact(run, "test-setup", "grant-agent", {}, (draft) => {
    draft.agents = [
      {
        id,
        role,
        parent_agent_id: null,
        parent_task_id: null,
        host: "test",
        granted_at: new Date().toISOString(),
        status,
      },
    ];
  });
}


describe("meta-audit execute authority", () => {
  test("denies ghost, released, and implementer actors through execute", async () => {
    for (const [id, role, status] of [
      ["ghost", undefined, undefined],
      ["released", "coordinator", "released"],
      ["worker", "implementer", "active"],
    ] as const) {
      const { run } = await emptyGrantRun(`meta-audit-${id}-`);
      if (role !== undefined && status !== undefined) installMetaAuditGrant(run, id, role, status);
      await expect(
        execute(["meta-audit", "--run", run, "--actor", id, "--inject"]),
      ).rejects.toThrow();
    }
  });

  test("accepts active coordinator actor and never treats --agent filter as actor", async () => {
    const { run } = await emptyGrantRun("meta-audit-coordinator-");
    installMetaAuditGrant(run, "coordinator", "coordinator");
    registerSessionGrant({ runRoot: run, agentId: "coordinator", role: "coordinator" });
    const result = await execute([
      "meta-audit",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--agent",
      "victim",
    ]);
    expect(result.run_root).toBe(run);
    revokeSessionGrant({
      runRoot: run,
      agentId: "coordinator",
      pid: process.pid,
      ppid: process.ppid,
    });
    await expect(
      execute(["meta-audit", "--run", run, "--agent", "victim", "--inject"]),
    ).rejects.toThrow("--actor is required");
  });

  test("accepts an active skill-auditor actor through execute", async () => {
    const { run } = await emptyGrantRun("meta-audit-skill-auditor-");
    installMetaAuditGrant(run, "skill-auditor", "skill-auditor");
    registerSessionGrant({ runRoot: run, agentId: "skill-auditor", role: "skill-auditor" });
    const result = await execute(["meta-audit", "--run", run, "--actor", "skill-auditor"]);
    expect(result.run_root).toBe(run);
  });

  test("auto-fills a verified durable coordinator session through execute", async () => {
    const { run } = await emptyGrantRun("meta-audit-session-");
    installMetaAuditGrant(run, "session-coordinator", "coordinator");
    registerSessionGrant({ runRoot: run, agentId: "session-coordinator", role: "coordinator" });
    const result = await execute(["meta-audit", "--run", run]);
    expect(result.run_root).toBe(run);
  });

  test("does not auto-fill a meta-audit actor from fake PID or PPID session records", async () => {
    const { run } = await emptyGrantRun("meta-audit-fake-process-");
    installMetaAuditGrant(run, "fake-process-coordinator", "coordinator");
    registerSessionGrant({
      runRoot: run,
      agentId: "fake-process-coordinator",
      role: "coordinator",
      pid: 812345,
      ppid: 812344,
    });

    await expect(execute(["meta-audit", "--run", run, "--inject"])).rejects.toThrow(
      "--actor is required",
    );
  });
});

describe("quota lifecycle execute authority", () => {
  test("requires a run and a verified actor before any quota snapshot can be written", async () => {
    const { repo, run } = await emptyGrantRun("quota-identity-required-");
    const snapshot = join(repo, ".olt", "quota-dag-snapshot.json");
    await expect(execute(["quota:freeze", "--run", run, "--force"])).rejects.toThrow(
      "--actor is required",
    );
    await expect(execute(["quota:freeze", "--actor", "ghost", "--force"])).rejects.toThrow(
      "--run is required",
    );
    expect(existsSync(snapshot)).toBe(false);
  });

  test("denies ghost, released, and implementer actors even with --force", async () => {
    for (const [id, role, status] of [
      ["ghost", undefined, undefined],
      ["released", "mind", "released"],
      ["worker", "implementer", "active"],
    ] as const) {
      const { repo, run } = await emptyGrantRun(`quota-denied-${id}-`);
      if (role !== undefined && status !== undefined) installMetaAuditGrant(run, id, role, status);
      await expect(
        execute(["quota:freeze", "--run", run, "--actor", id, "--force"]),
      ).rejects.toThrow();
      expect(existsSync(join(repo, ".olt", "quota-dag-snapshot.json"))).toBe(false);
    }
  });

  test("permits only active mind and orchestrator grants to freeze and resume the bound run", async () => {
    const { repo, run } = await emptyGrantRun("quota-allowed-");
    const initialized = spawnSync("git", ["init", "--quiet", repo]);
    if (initialized.status !== 0)
      throw new Error("could not initialize quota authority test repository");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
    const frozen = await execute(["quota:freeze", "--run", run, "--actor", "mind", "--force"]);
    expect(frozen.status).toBe("frozen");
    expect(loadDagSnapshot(repo)?.runRoot).toBe(run);
    installMetaAuditGrant(run, "orchestrator", "orchestrator");
    registerSessionGrant({ runRoot: run, agentId: "orchestrator", role: "orchestrator" });
    const resumed = await execute([
      "quota:resume",
      "--run",
      run,
      "--actor",
      "orchestrator",
      "--force",
    ]);
    expect(resumed.status).toBe("resumed");
    expect(loadDagSnapshot(repo)?.status).toBe("resumed");
  });
});
