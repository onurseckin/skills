import { describe, expect, test } from "bun:test";
import {
  CAPSULE_GENESIS_COMMANDS,
  CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
  GRANT_BOOTSTRAP_ALLOWLIST,
  GRANT_GENESIS_COMMANDS,
  isGrantBootstrapExempt,
} from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";

function spec(invocation: string) {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

describe("grant bootstrap allowlist data", () => {
  test("capsule genesis commands are the ones that create a capsule before any ledger exists", () => {
    expect([...CAPSULE_GENESIS_COMMANDS].sort()).toEqual(
      ["mind:init", "orchestrate", "plan:init"].sort(),
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

  test("the combined allowlist is the union of its three named categories with no extra entries", () => {
    const union = new Set([
      ...CAPSULE_GENESIS_COMMANDS,
      ...GRANT_GENESIS_COMMANDS,
      ...CONTEXT_FREE_DIAGNOSTIC_COMMANDS,
    ]);
    expect(GRANT_BOOTSTRAP_ALLOWLIST.size).toBe(union.size);
    for (const entry of union) expect(GRANT_BOOTSTRAP_ALLOWLIST.has(entry)).toBe(true);
  });

  test("isGrantBootstrapExempt matches every command in the allowlist by canonical name", () => {
    for (const name of GRANT_BOOTSTRAP_ALLOWLIST) {
      expect(isGrantBootstrapExempt(spec(name))).toBe(true);
    }
  });

  test("isGrantBootstrapExempt matches an allowlisted command through a registered alias", () => {
    expect(isGrantBootstrapExempt(spec("role:contract"))).toBe(true);
    expect(isGrantBootstrapExempt(spec("role:cheat"))).toBe(true);
  });

  test("isGrantBootstrapExempt rejects an ordinary granted command", () => {
    expect(isGrantBootstrapExempt(spec("task:submit"))).toBe(false);
    expect(isGrantBootstrapExempt(spec("task:heartbeat"))).toBe(false);
    expect(isGrantBootstrapExempt(spec("queue:pop"))).toBe(false);
  });

  test("every allowlisted command actually exists in the live registry", () => {
    for (const name of GRANT_BOOTSTRAP_ALLOWLIST) {
      expect(() => spec(name)).not.toThrow();
    }
  });
});
