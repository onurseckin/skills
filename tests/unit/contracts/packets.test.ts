import { describe, expect, test } from "bun:test";
import {
  AGENT_ROLES,
  isAgentRole,
  isAnyValidatorRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
} from "../../../olt/scripts/src/core/contracts/packets.ts";

describe("core contracts/packets", () => {
  test("AGENT_ROLES lists all 16 canonical roles", () => {
    expect(AGENT_ROLES.length).toBe(16);
    expect(AGENT_ROLES).toContain("mind");
    expect(AGENT_ROLES).toContain("orchestrator");
    expect(AGENT_ROLES).toContain("coordinator");
    expect(AGENT_ROLES).toContain("implementer");
    expect(AGENT_ROLES).toContain("validator");
  });

  test("isAgentRole validates canonical roles", () => {
    expect(isAgentRole("mind")).toBe(true);
    expect(isAgentRole("implementer")).toBe(true);
    expect(isAgentRole("validator")).toBe(true);
    expect(isAgentRole("unknown_role")).toBe(false);
    expect(isAgentRole(123)).toBe(false);
    expect(isAgentRole(null)).toBe(false);
  });

  test("isCognitiveValidatorRole identifies cognitive validator roles", () => {
    expect(isCognitiveValidatorRole("validator")).toBe(true);
    expect(isCognitiveValidatorRole("ui-validator")).toBe(true);
    expect(isCognitiveValidatorRole("validator-code-quality")).toBe(true);
    expect(isCognitiveValidatorRole("implementer")).toBe(false);
    expect(isCognitiveValidatorRole("mechanic-validator")).toBe(false);
  });

  test("isMechanicValidatorRole identifies mechanic validator roles", () => {
    expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("mechanic_validator")).toBe(true);
    expect(isMechanicValidatorRole("validator")).toBe(false);
    expect(isMechanicValidatorRole("coordinator")).toBe(false);
  });

  test("isAnyValidatorRole matches either cognitive or mechanic validators", () => {
    expect(isAnyValidatorRole("validator")).toBe(true);
    expect(isAnyValidatorRole("mechanic-validator")).toBe(true);
    expect(isAnyValidatorRole("implementer")).toBe(false);
  });
});
