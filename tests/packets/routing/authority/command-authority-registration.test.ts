import { afterAll, beforeAll, describe, expect, test } from "bun:test";

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
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "./command-authority-fixture.ts";

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

describe("assertGrantedCommand registration & targets", () => {
  beforeAll(() => {
    setupVirtualAuthorityFS();
  });

  afterAll(() => {
    cleanupVirtualAuthorityFS();
  });

  test("HIGH 5: branch-worker roles are exempt from the tier ladder, but only for Tier 3 parents", () => {
    expect(() => assertHierarchicalSpawning("implementer", "sub-implementer")).toThrow(
      HarnessError,
    );
  });

  test("HIGH 5: a coordinator's declared spawns allowlist narrows what agent:register permits, even for a tier-legal role", async () => {
    const { run } = await emptyGrantRun("command-authority-high5-narrowing-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coord-narrow",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const undeclaredButTierLegal: Flags = {
      run,
      agent: "ui-headless-validator-1",
      role: "ui-headless-validator",
      host: "claude-code",
      "parent-agent": "coord-narrow",
      actor: "coord-narrow",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), undeclaredButTierLegal)).toThrow(
      "Declared spawn allowlist violation",
    );

    const declaredAndTierLegal: Flags = {
      run,
      agent: "impl-declared",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "coord-narrow",
      actor: "coord-narrow",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), declaredAndTierLegal)).not.toThrow();

    const declaredButNoActingIdentity: Flags = {
      run,
      agent: "impl-declared-2",
      role: "implementer",
      host: "claude-code",
      "parent-agent": "coord-narrow",
    };
    expect(() => assertGrantedCommand(spec("agent:register"), declaredButNoActingIdentity)).toThrow(
      HarnessError,
    );
  });

  test("excludes a command's own subject flag from the candidates it reads the acting agent from", async () => {
    const { run } = await emptyGrantRun("command-authority-subject-exclusion-");
    transact(run, "test-setup", "grant-agent", {}, (draft) => {
      draft.agents = [
        {
          id: "coordinator-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    const flags: Flags = { run, actor: "coordinator-1", agent: "not-a-real-agent" };
    expect(() =>
      assertGrantedCommand(spec("agent:report"), flags, {
        actor: "coordinator-1",
        role: "coordinator",
        verified: true,
      }),
    ).toThrow("does not match authenticated caller 'coordinator-1'");
  });
});
