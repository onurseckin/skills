import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import {
  cleanupVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../authority/command-authority-fixture.ts";

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

beforeAll(() => {
  setupVirtualAuthorityFS();
});

afterAll(() => {
  cleanupVirtualAuthorityFS();
});

describe("assertGrantedCommand hole 5: revocation is honoured, not theatre", () => {
  test("denies a released agent outright, distinct from an unregistered ghost", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-released-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "probe-released",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
          released_at: new Date().toISOString(),
          release_reason: "test-teardown",
        },
      ];
    });

    const flags: Flags = { run, agent: "probe-released" };
    expect(() => assertGrantedCommand(spec("task:heartbeat"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("a released agent stays denied even for a command it would otherwise hold a valid role for", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-role-valid-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "probe-released-2",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });

    const flags: Flags = { run, actor: "probe-released-2" };
    expect(() => assertGrantedCommand(spec("task:claim"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("a released coordinator cannot invoke agent:register despite grant genesis being bootstrap-exempt", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-register-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-coordinator",
          role: "coordinator",
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
      actor: "released-coordinator",
      "parent-agent": "released-coordinator",
      role: "implementer",
      agent: "impl-should-not-exist",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), flags)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("an active grant is unaffected by the status filter", async () => {
    const { run } = await emptyGrantRun("fail-closed-hole5-active-control-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "active-implementer",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, agent: "active-implementer" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });
});

describe("assertGrantedCommand end to end: role contract is enforced once a grant resolves", () => {
  test("a granted actor whose role contract allows the command is permitted", async () => {
    const { run } = await emptyGrantRun("fail-closed-role-allowed-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "impl-permitted",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, agent: "impl-permitted" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).not.toThrow();
  });

  test("a granted actor whose role contract does not allow the command is denied, naming actor, command and reason", async () => {
    const { run } = await emptyGrantRun("fail-closed-role-denied-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "val-denied",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, validator: "val-denied" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("task:submit"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("val-denied");
    expect(message).toContain("task:submit");
    expect(message).toContain("may not invoke");
  });

  test("an unresolved role denies rather than silently skipping the contract check", async () => {
    const { run } = await emptyGrantRun("fail-closed-unresolved-role-");
    const flags: Flags = { run, agent: "no-such-agent-in-ledger" };
    let thrown: unknown;
    try {
      assertGrantedCommand(spec("task:submit"), flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HarnessError);
    const message = (thrown as HarnessError).message;
    expect(message).toContain("no-such-agent-in-ledger");
    expect(message).toContain("task:submit");
    expect(message).toContain("no grant");
  });
});
