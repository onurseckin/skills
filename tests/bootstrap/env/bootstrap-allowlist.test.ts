import { describe, expect, it } from "bun:test";
import {
  isGrantBootstrapExempt,
  isMissingCapsuleBootstrapExempt,
  declaresRunIdentityFlag,
  declaresActingIdentityFlag,
  CAPSULE_GENESIS_COMMANDS,
  GRANT_BOOTSTRAP_ALLOWLIST,
} from "../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";

describe("Bootstrap Grant Allowlist & Exemption Evaluation", () => {
  it("recognizes grant bootstrap exempt commands", () => {
    const spec: CommandSpec = {
      name: "mind:init",
      description: "Initialize mind",
      aliases: [],
      flags: [],
      positionals: [],
      handler: "handleMindInit",
      modulePath: "mind-init.ts",
    };
    expect(isGrantBootstrapExempt(spec)).toBe(true);
    expect(isMissingCapsuleBootstrapExempt(spec)).toBe(true);
  });

  it("identifies run and acting identity flags", () => {
    const specWithRun: CommandSpec = {
      name: "test:cmd",
      description: "Test cmd",
      aliases: [],
      flags: [{ name: "run", description: "Run id", type: "string" }],
      positionals: [],
      handler: "handleTest",
      modulePath: "test.ts",
    };
    expect(declaresRunIdentityFlag(specWithRun)).toBe(true);
    expect(declaresActingIdentityFlag(specWithRun)).toBe(false);
  });

  it("exports canonical capsule genesis commands set", () => {
    expect(CAPSULE_GENESIS_COMMANDS.has("mind:init")).toBe(true);
    expect(GRANT_BOOTSTRAP_ALLOWLIST.size).toBeGreaterThan(0);
  });
});
