import { describe, expect, it } from "bun:test";
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { readFrontmatter } from "../../../olt/scripts/src/packets/roles/role-contract-rules.ts";

describe("Supervisory Rule: Role Contracts & Authority Invariants", () => {
  it("discriminates agent roles accurately", () => {
    expect(isAgentRole("implementer")).toBe(true);
    expect(isAgentRole("coordinator")).toBe(true);
    expect(isAgentRole("orchestrator")).toBe(true);
    expect(isAgentRole("validator")).toBe(true);
    expect(isAgentRole("invalid-role")).toBe(false);
  });

  it("discriminates cognitive and mechanic validator roles", () => {
    expect(isCognitiveValidatorRole("validator")).toBe(true);
    expect(isCognitiveValidatorRole("ui-optical-validator")).toBe(true);
    expect(isCognitiveValidatorRole("implementer")).toBe(false);

    expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
    expect(isMechanicValidatorRole("coordinator")).toBe(false);
  });

  it("parses valid frontmatter from role contracts", () => {
    const lines = [
      "---",
      "role: coordinator",
      "tier: 1",
      "responsibilities:",
      "  - delegate tasks",
      "  - coordinate subagents",
      "---",
    ];
    const listFields = new Set(["responsibilities"]);
    const res = readFrontmatter(lines.slice(1, -1), "test.md", listFields, "contract");
    expect(res.scalars.get("role")).toBe("coordinator");
    expect(res.scalars.get("tier")).toBe("1");
    expect(res.lists.get("responsibilities")).toEqual(["delegate tasks", "coordinate subagents"]);
  });
});
