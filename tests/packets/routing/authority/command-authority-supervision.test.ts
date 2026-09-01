import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import {
  assertGrantedCommand as assertRawGrantedCommand,
  type AuthenticatedCaller,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  roleToTier,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertCognitiveValidatorHardlock,
  assertRoleMayInvoke,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";

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

function assertGrantedCommand(
  specification: CommandSpec,
  flags: Flags,
  caller?: AuthenticatedCaller,
) {
  return assertRawGrantedCommand(specification, flags, caller ?? testCaller(specification, flags));
}

describe("assertGrantedCommand supervision rules", () => {
  test("CRITICAL 1: --parent-agent given but no acting identity resolves is refused outright, never routed on into the hierarchy check", async () => {
    const { run } = await emptyGrantRun("command-authority-critical1-repro-");
    const bootstrapOrchestrator: Flags = {
      run,
      agent: "orchestrator-1",
      role: "orchestrator",
      host: "claude-code",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), bootstrapOrchestrator)).not.toThrow();
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "orchestrator-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const noActorGiven: Flags = {
      run,
      agent: "impl-skip-tier",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "orchestrator-1",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), noActorGiven)).toThrow(HarnessError);

    const wrongActorGiven: Flags = {
      ...noActorGiven,
      agent: "impl-skip-tier-2",
      actor: "someone-unrelated",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), wrongActorGiven)).toThrow(
      "does not match --parent-agent",
    );

    const provenActorButIllegalTierJump: Flags = {
      ...noActorGiven,
      agent: "impl-skip-tier-3",
      actor: "orchestrator-1",
    };
    expect(() =>
      assertGrantedCommand(spec("agent:register"), provenActorButIllegalTierJump),
    ).toThrow("may only dispatch Tier 2 Coordinators");
  });

  test("HIGH 4: an unresolvable or inactive --parent-agent is an error, never a silent skip", async () => {
    const { run } = await emptyGrantRun("command-authority-high4-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "released-coord",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "released",
        },
      ];
    });

    const nonexistentParent: Flags = {
      run,
      agent: "impl-1",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "ghost-parent-not-in-ledger",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), nonexistentParent)).toThrow(
      HarnessError,
    );

    const inactiveParent: Flags = {
      run,
      agent: "impl-2",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "released-coord",
      actor: "released-coord",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), inactiveParent)).toThrow(
      "holds a released grant, not an active one",
    );
  });

  test("CRITICAL 2/HIGH 3: registering an unparented Tier 0/1 agent requires a resolvable, granted acting identity once genesis has passed", async () => {
    const { run } = await emptyGrantRun("command-authority-critical2-");
    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        agent: "mind-1",
        role: "mind",
        host: "claude-code",
      }),
    ).not.toThrow();
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

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        agent: "orchestrator-2",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "nobody-registered",
        agent: "orchestrator-3",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).toThrow("holds no active grant in this run");

    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      const agents = Array.isArray(draft.agents) ? draft.agents : [];
      draft.agents = [
        ...agents,
        {
          id: "impl-escalator",
          role: "implementer",
          parent_agent_id: "mind-1",
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });
    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "impl-escalator",
        agent: "self-minted-mind",
        role: "mind",
        host: "claude-code",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      assertGrantedCommand(spec("agent:register"), {
        run,
        actor: "mind-1",
        agent: "orchestrator-legit",
        role: "orchestrator",
        host: "claude-code",
      }),
    ).not.toThrow();
  });
});
