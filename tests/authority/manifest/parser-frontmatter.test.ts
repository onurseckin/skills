import { describe, expect, test } from "bun:test";
import {
  parseMarkdownFrontmatter,
  parseRoleContract,
} from "../../../olt/scripts/src/authority/manifest/index.ts";

describe("Authority Manifest Parser - Markdown Frontmatter", () => {
  test("extracts markdown frontmatter and body cleanly", () => {
    const markdown = `---
role: coordinator
tier: 2
may:
  - Command 1
  - Command 2
must_not:
  - Breach 1
---

# Coordinator Header

This is the main body content of the role contract.
`;
    const { frontmatter, body } = parseMarkdownFrontmatter<Record<string, unknown>>(markdown);
    expect(frontmatter.role).toBe("coordinator");
    expect(frontmatter.tier).toBe(2);
    expect(frontmatter.may).toEqual(["Command 1", "Command 2"]);
    expect(frontmatter.must_not).toEqual(["Breach 1"]);
    expect(body).toContain("# Coordinator Header");
    expect(body).toContain("This is the main body content of the role contract.");
  });

  test("returns empty frontmatter if delimiter is missing or malformed", () => {
    const markdown = `# Title\n\nNo frontmatter here.`;
    const { frontmatter, body } = parseMarkdownFrontmatter(markdown);
    expect(frontmatter).toEqual({});
    expect(body).toBe(markdown);

    const singleDelimiter = `---\nrole: incomplete\nNo closing delimiter`;
    const res = parseMarkdownFrontmatter(singleDelimiter);
    expect(res.frontmatter).toEqual({});
    expect(res.body).toBe(singleDelimiter);
  });

  test("parses role contract with both YAML and Markdown formats", () => {
    const rawContract = `---
role: coordinator
tier: 2
domain: execution
may:
  - Compile task graphs
  - Dispatch wave lanes
must_not:
  - Edit application code
  - Bypass harness CLI
commands:
  - plan:compile
  - queue:wave
spawns:
  - implementer
  - validator
---
# Coordinator Contract

Coordinator owns the run, not the code.
`;
    const contract = parseRoleContract(rawContract, "roles/coordinator.md");
    expect(contract.role).toBe("coordinator");
    expect(contract.tier).toBe(2);
    expect(contract.domain).toBe("execution");
    expect(contract.may).toEqual(["Compile task graphs", "Dispatch wave lanes"]);
    expect(contract.mustNot).toEqual(["Edit application code", "Bypass harness CLI"]);
    expect(contract.commands).toEqual(["plan:compile", "queue:wave"]);
    expect(contract.spawns).toEqual(["implementer", "validator"]);
    expect(contract.body).toContain("# Coordinator Contract");
    expect(contract.filePath).toBe("roles/coordinator.md");
  });
});
