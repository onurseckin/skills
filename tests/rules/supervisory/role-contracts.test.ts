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

    expect(isMechanicValidatorRole("ui-headless-validator")).toBe(true);
    expect(isMechanicValidatorRole("mechanic-validator")).toBe(false);
    expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(false);
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

  it("throws error on duplicate frontmatter key", () => {
    const lines = [
      "role: coordinator",
      "tier: 1",
      "role: orchestrator",
    ];
    expect(() => readFrontmatter(lines, "test.md", new Set(), "contract")).toThrow(
      /duplicate key: role/,
    );
  });

  it("throws error on list item outside a list", () => {
    const lines = [
      "role: coordinator",
      "  - dangling item",
    ];
    expect(() => readFrontmatter(lines, "test.md", new Set(), "contract")).toThrow(
      /list item outside a list/,
    );
  });

  it("handles multiline continuation in frontmatter list item", () => {
    const lines = [
      "responsibilities:",
      "  - delegate tasks",
      "    across multiple teams",
    ];
    const listFields = new Set(["responsibilities"]);
    const res = readFrontmatter(lines, "test.md", listFields, "contract");
    expect(res.lists.get("responsibilities")).toEqual(["delegate tasks across multiple teams"]);
  });

  it("parses empty list with explicit bracket syntax []", () => {
    const lines = ["responsibilities: []"];
    const listFields = new Set(["responsibilities"]);
    const res = readFrontmatter(lines, "test.md", listFields, "contract");
    expect(res.lists.get("responsibilities")).toEqual([]);
  });

  it("parses values containing multiple colons without truncation", () => {
    const lines = ["url: https://example.com:8080/api/v1"];
    const res = readFrontmatter(lines, "test.md", new Set(), "contract");
    expect(res.scalars.get("url")).toBe("https://example.com:8080/api/v1");
  });

  it("rejects non-standard lines lacking colon delimiter", () => {
    const lines = ["invalid_line_without_colon"];
    expect(() => readFrontmatter(lines, "test.md", new Set(), "contract")).toThrow(
      /unparsable line: invalid_line_without_colon/,
    );
  });
});
