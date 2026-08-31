import { describe, expect, test } from "bun:test";
import {
  CAPSULE_GENESIS_COMMANDS,
  CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
  GRANT_BOOTSTRAP_ALLOWLIST,
  GRANT_GENESIS_COMMANDS,
  PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
  declaresRunIdentityFlag,
  isGrantBootstrapExempt,
  isMissingCapsuleBootstrapExempt,
} from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { COMMAND_REGISTRY, findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("grant bootstrap allowlist data", () => {
  test("capsule genesis commands are the ones that create a capsule before any ledger exists", () => {
    expect([...CAPSULE_GENESIS_COMMANDS].sort()).toEqual(
      ["mind:init", "orchestrate", "plan:init", "run:init"].sort(),
    );
  });

  test("grant genesis contains exactly agent:register", () => {
    expect([...GRANT_GENESIS_COMMANDS]).toEqual(["agent:register"]);
  });

  test("context-free diagnostics enumerates the commands with no identity flag that must stay reachable", () => {
    expect([...CONTEXT_FREE_DIAGNOSTIC_COMMANDS].sort()).toEqual(
      [
        "agent:brief",
        "doctor",
        "explain",
        "health",
        "role:cheat-sheet",
        "task:check",
        "whoami",
      ].sort(),
    );
  });

  test("pre-compile plan construction commands are the plan-shaping commands callable before compile mints any task grant", () => {
    expect([...PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS].sort()).toEqual(
      ["plan:add", "plan:brainstorm", "plan:compile", "plan:enhance"].sort(),
    );
  });

  test("the combined allowlist is the union of its four named categories with no extra entries", () => {
    const union = new Set([
      ...CAPSULE_GENESIS_COMMANDS,
      ...GRANT_GENESIS_COMMANDS,
      ...CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
      ...PRE_COMPILE_PLAN_CONSTRUCTION_COMMANDS,
    ]);
    expect(GRANT_BOOTSTRAP_ALLOWLIST.size).toBe(union.size);
    for (const entry of union) expect(GRANT_BOOTSTRAP_ALLOWLIST.has(entry)).toBe(true);
  });

  test("isGrantBootstrapExempt matches every command in the allowlist by canonical name", () => {
    for (const name of GRANT_BOOTSTRAP_ALLOWLIST) {
      expect(isGrantBootstrapExempt(spec(name))).toBe(true);
    }
  });

  test("isGrantBootstrapExempt matches an allowlisted command", () => {
    expect(isGrantBootstrapExempt(spec("role:cheat-sheet"))).toBe(true);
    expect(isGrantBootstrapExempt(spec("whoami"))).toBe(true);
  });

  test("isGrantBootstrapExempt rejects an ordinary granted command", () => {
    expect(isGrantBootstrapExempt(spec("task:submit"))).toBe(false);
    expect(isGrantBootstrapExempt(spec("task:heartbeat"))).toBe(false);
    expect(isGrantBootstrapExempt(spec("queue:pop"))).toBe(false);
  });

  test("missing-capsule permission is restricted to capsule and grant genesis, not grant-free plan construction", () => {
    const trueGenesis = new Set([...CAPSULE_GENESIS_COMMANDS, ...GRANT_GENESIS_COMMANDS]);
    for (const name of GRANT_BOOTSTRAP_ALLOWLIST) {
      expect(isMissingCapsuleBootstrapExempt(spec(name))).toBe(trueGenesis.has(name));
    }
    expect(isMissingCapsuleBootstrapExempt(spec("plan:brainstorm"))).toBe(false);
  });

  test("every allowlisted command actually exists in the live registry", () => {
    for (const name of GRANT_BOOTSTRAP_ALLOWLIST) {
      expect(() => spec(name)).not.toThrow();
    }
  });
});

describe("declaresRunIdentityFlag: the structural hole 1 predicate", () => {
  test("is false for commands that declare no --run/--run-id flag at all", () => {
    expect(declaresRunIdentityFlag(spec("mind:init"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("health"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("explain"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("agent:brief"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("role:cheat-sheet"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("install"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("queue:status"))).toBe(false);
    expect(declaresRunIdentityFlag(spec("queue:add"))).toBe(false);
  });

  test("is true for commands that declare a --run/--run-id flag, whether required or optional", () => {
    expect(declaresRunIdentityFlag(spec("plan:init"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("orchestrate"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("run:init"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("agent:register"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("doctor"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("whoami"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("task:check"))).toBe(true);
  });

  test("is true even when the flag is optional rather than required, distinguishing it from context-free", () => {
    expect(declaresRunIdentityFlag(spec("shell"))).toBe(true);
    expect(declaresRunIdentityFlag(spec("scope:expand"))).toBe(true);
  });

  test("matches the count of commands with no run/run-id flag in the live registry", () => {
    const commandsWithNoRunFlag = COMMAND_REGISTRY.filter(
      (candidate) => !declaresRunIdentityFlag(candidate),
    );
    expect(commandsWithNoRunFlag.length).toBe(54);
  });
});
