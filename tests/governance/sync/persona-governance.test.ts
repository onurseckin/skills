import { describe, expect, it } from "bun:test";
import { isUserPersonaRole, MANDATORY_PERSONA_ROLES } from "../../../olt/scripts/src/platform/capture/persona-governance.ts";

describe("Persona Governance Evaluation", () => {
  it("identifies mandatory user persona roles accurately", () => {
    expect(isUserPersonaRole("admin")).toBe(true);
    expect(isUserPersonaRole("standard_user")).toBe(true);
    expect(isUserPersonaRole("invalid_role")).toBe(false);
  });

  it("exports mandatory persona roles list", () => {
    expect(MANDATORY_PERSONA_ROLES).toContain("admin");
    expect(MANDATORY_PERSONA_ROLES).toContain("guest");
  });
});
