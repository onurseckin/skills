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

describe("assertGrantedCommand hole 6: agent:register --parent-agent binding fails open when the actor is absent", () => {
  async function seedActiveMind(run: string): Promise<void> {
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "mind-1",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });
  }

  test("denies minting a Tier 1 orchestrator under a named --parent-agent when no acting identity is supplied at all", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-no-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-stolen",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
    };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("agent:register"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const error = thrown as HarnessError;
    expect(error.code).toBe("AUTHENTICATION_FAILURE");
    expect(error.message).toContain("mind-1");
    expect(error.message).not.toContain("Agent Granted");
  });

  test("denies an unverified explicit --actor instead of treating its value as parent proof", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-wrong-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-x",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
      actor: "orch-stolen",
    };
    let thrown: unknown;
    try {
      assertRawGrantedCommand(spec("agent:register"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    expect((thrown as HarnessError).code).toBe("AUTHENTICATION_FAILURE");
  });

  test("permits the same registration once --actor proves the caller really is the named parent", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-legit-actor-");
    await seedActiveMind(run);

    const flags: Flags = {
      run,
      agent: "orch-legit",
      role: "orchestrator",
      host: "claude-code",
      "parent-agent": "mind-1",
      actor: "mind-1",
    };
    expect(() =>
      assertRawGrantedCommand(spec("agent:register"), flags, {
        actor: "mind-1",
        role: "mind",
        verified: true,
      }),
    ).not.toThrow();
  });

  test("omitting the actor is denied identically whichever acting-identity flag would have carried it", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole6-no-actor-variants-");
    await seedActiveMind(run);

    for (const flags of [
      {
        run,
        agent: "orch-stolen-a",
        role: "orchestrator",
        host: "claude-code",
        "parent-agent": "mind-1",
      },
      {
        run,
        agent: "orch-stolen-b",
        role: "orchestrator",
        host: "claude-code",
        "parent-agent": "mind-1",
        validator: undefined,
      },
    ] satisfies Flags[]) {
      let thrown: unknown;
      try {
        assertGrantedCommand(spec("agent:register"), flags);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HarnessError);
      expect((thrown as HarnessError).code).toBe("AUTHENTICATION_FAILURE");
    }
  });
});

describe("assertSpawnAuthorized: an unreadable declared-spawn role contract denies rather than waives the allowlist", () => {
  test("denies dispatch when the parent role's contract file cannot be loaded from disk", () => {
    const unregisteredParentRole = "orchestrator-ghost-contract" as unknown as AgentRole;
    let thrown: unknown;
    try {
      assertSpawnAuthorized(unregisteredParentRole, "coordinator");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const error = thrown as HarnessError;
    expect(error.code).toBe("ROLE_CONFINEMENT_VIOLATION");
    expect(error.message).toContain("could not be loaded");
    expect(error.message).toContain("does not waive the declared-spawn allowlist");
  });

  test("a readable contract that declares the child role still passes, as a control", () => {
    expect(() => assertSpawnAuthorized("orchestrator", "coordinator")).not.toThrow();
  });
});
