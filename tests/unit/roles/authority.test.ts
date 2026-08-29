import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  FORBIDDEN_VALIDATOR_COMMANDS,
  validateRoleAuthorityInvariants,
} from "../../../olt/scripts/src/roles/index.ts";

describe("Roles authority invariants enforcement", () => {
  test("defines forbidden validator commands", () => {
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("run:exec")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("task:claim")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("task:submit")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("task:assign-repairer")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("shell")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("run_command")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("edit_file")).toBe(true);
    expect(FORBIDDEN_VALIDATOR_COMMANDS.has("write_to_file")).toBe(true);
  });

  test("passes validation for benign roles and non-forbidden commands", () => {
    expect(() =>
      validateRoleAuthorityInvariants("implementer", "default", ["task:claim", "run:exec"]),
    ).not.toThrow();

    expect(() =>
      validateRoleAuthorityInvariants("validator", "adversarial", [
        "gate:check",
        "evidence:record",
      ]),
    ).not.toThrow();
  });

  test("throws ROLE_CONFINEMENT_VIOLATION when validator is granted mutating commands", () => {
    expect(() =>
      validateRoleAuthorityInvariants("validator", "adversarial", ["gate:check", "run:exec"]),
    ).toThrow(HarnessError);

    expect(() =>
      validateRoleAuthorityInvariants("custom-critic", "adversarial", [
        "critic:evaluate",
        "task:claim",
      ]),
    ).toThrow(HarnessError);

    expect(() =>
      validateRoleAuthorityInvariants("validator-security", "default", ["edit_file"]),
    ).toThrow(HarnessError);
  });
});
