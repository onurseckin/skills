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

describe("assertGrantedCommand: run-optional identity-free commands permit the no-flag invocation", () => {
  test("permits report, run:status, branch:status, memory:query, queue:wave and plan:status with zero flags", () => {
    expect(() => assertGrantedCommand(spec("report"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("run:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("report:summary"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("branch:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("memory:query"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:wave"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("plan:status"), {})).not.toThrow();
  });

  test("requires authority-run for watchdog mutation commands while keeping inspection context-free", () => {
    expect(() => assertGrantedCommand(spec("watchdog:cleanup"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("watchdog:phase-cleanup"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("watchdog:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:verify"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("watchdog:probe"), {})).not.toThrow();
  });

  test("permits dag with zero flags despite declaring an --actor display filter", () => {
    expect(() => assertGrantedCommand(spec("dag"), {})).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("dag"), { run: "/nonexistent/probe-run", actor: "impl-7" }),
    ).not.toThrow();
  });
});

describe("assertGrantedCommand: pre-compile plan construction runs before any grant exists", () => {
  test("permits plan:add, plan:compile and plan:brainstorm for an unregistered planner in a fresh capsule", async () => {
    const { run } = await emptyGrantRun("fail-closed-plan-construction-permit-");
    expect(() =>
      assertGrantedCommand(spec("plan:add"), {
        run,
        id: "task-1",
        label: "First task",
        actor: "planner",
      }),
    ).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("plan:compile"), { run, actor: "planner" }),
    ).not.toThrow();
    expect(() =>
      assertGrantedCommand(spec("plan:brainstorm"), { run, actor: "planner" }),
    ).not.toThrow();
  });

  test("a released planner still denies plan:add: the pre-compile exemption never overrides an active revocation", async () => {
    const { run } = await emptyGrantRun("fail-closed-plan-construction-revoked-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-planner",
          role: "planner",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });
    const flags: Flags = {
      run,
      id: "task-1",
      label: "First task",
      actor: "released-planner",
    };
    expect(() => assertGrantedCommand(spec("plan:add"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });
});

describe("assertGrantedCommand: the false-positive repair does not widen into a bypass", () => {
  test("still denies task:claim for a never-registered actor, even with --run supplied", async () => {
    const { run } = await emptyGrantRun("fail-closed-task-claim-ghost-");
    const flags: Flags = { run, task: "task-1", agent: "worker-1", role: "implementer" };
    expect(() => assertGrantedCommand(spec("task:claim"), flags)).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS and GRANT_BOOTSTRAP_ALLOWLIST hold only the intended pre-compile commands, not general task-lifecycle authority", () => {
    expect([...PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS].sort()).toEqual(
      ["plan:add", "plan:brainstorm", "plan:compile", "plan:enhance"].sort(),
    );
    for (const authorityBearingCommand of [
      "task:claim",
      "task:submit",
      "task:heartbeat",
      "run:complete",
      "authority:decide",
    ]) {
      expect(GRANT_BOOTSTRAP_ALLOWLIST.has(authorityBearingCommand)).toBe(false);
      expect(requiresActingIdentity(spec(authorityBearingCommand))).toBe(true);
    }
  });

  test("a synthetic authority-bearing command shaped like the exempt ones is still denied by name, not by shape", () => {
    const syntheticSpec: CommandSpec = {
      ...spec("task:claim"),
      name: "task:not-actually-exempt",
      aliases: [],
    };
    expect(() => assertGrantedCommand(syntheticSpec, {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() => assertGrantedCommand(syntheticSpec, { run: "/nonexistent/probe-run" })).toThrow(
      "verified caller session",
    );
  });
});
