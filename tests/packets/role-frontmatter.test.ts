import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  readFrontmatter,
  requireList,
  parseRoleContract,
  parseChecklist,
  extractValidatorDomainSection,
  isCognitiveValidatorContract,
  isMechanicValidatorContract,
  DOMAIN_ID_PREFIX,
  type RoleContract,
  type Checklist,
} from "../../../olt/scripts/src/packets/role-contract.ts";

const encoder = new TextEncoder();

function doc(
  frontmatter: string,
  body = "# Implementer\n\nPerform assigned unit tasks.",
): Uint8Array {
  return encoder.encode(`---\n${frontmatter}\n---\n\n${body}\n`);
}

function checklistDoc(domain: string, title = "Code Quality Checklist", items = ""): Uint8Array {
  return encoder.encode(`# ${title}\nDomain: ${domain}\n\n${items}`);
}

const validImplementer = [
  "role: implementer",
  "tier: 3",
  "may:",
  "  - Claim a ready task",
  "  - Modify designated workspace",
  "    files within lease",
  "must_not:",
  "  - Break repository invariants",
  "commands:",
  "  - task:claim",
  "  - task:submit",
  "spawns:",
  "  - sub-implementer",
].join("\n");

describe("role contract frontmatter & boundary enforcement", () => {
  test("readFrontmatter parses key-value scalars, block lists, and multiline continuations", () => {
    const lines = [
      "role: coordinator",
      "tier: 1",
      "spawns: []",
      "may:",
      "  - First permitted action",
      "  - Second permitted action with",
      "    wrapped multiline detail",
    ];
    const { scalars, lists } = readFrontmatter(
      lines,
      "test-contract",
      new Set(["may", "spawns"]),
      "role contract",
    );
    expect(scalars.get("role")).toBe("coordinator");
    expect(scalars.get("tier")).toBe("1");
    expect(lists.get("spawns")).toEqual([]);
    expect(lists.get("may")).toEqual([
      "First permitted action",
      "Second permitted action with wrapped multiline detail",
    ]);
  });

  test("readFrontmatter rejects malformed syntax, dangling continuations, and duplicate keys", () => {
    expect(() =>
      readFrontmatter(["  - orphan item"], "src", new Set(["may"]), "role contract"),
    ).toThrow("list item outside a list");

    expect(() =>
      readFrontmatter(["may:", "  - "], "src", new Set(["may"]), "role contract"),
    ).toThrow("empty may entry");

    expect(() =>
      readFrontmatter(
        ["   dangling continuation without parent"],
        "src",
        new Set(["may"]),
        "role contract",
      ),
    ).toThrow("dangling continuation");

    expect(() =>
      readFrontmatter(["invalid line without colon"], "src", new Set(["may"]), "role contract"),
    ).toThrow("unparsable line");

    expect(() =>
      readFrontmatter(
        ["role: planner", "role: implementer"],
        "src",
        new Set(["may"]),
        "role contract",
      ),
    ).toThrow("duplicate key: role");

    expect(() => readFrontmatter(["role:"], "src", new Set(["may"]), "role contract")).toThrow(
      "role has no value",
    );

    expect(() =>
      readFrontmatter(["may: not-a-list"], "src", new Set(["may"]), "role contract"),
    ).toThrow("may must be a block list or []");
  });

  test("requireList validates field presence, non-emptiness, and rejects duplicate items", () => {
    const { scalars, lists } = readFrontmatter(
      ["may:", "  - item1", "  - item1"],
      "src",
      new Set(["may"]),
      "role contract",
    );
    expect(() => requireList({ scalars, lists }, "may", "src")).toThrow("duplicate may entry");

    const emptyMay = readFrontmatter(["may: []"], "src", new Set(["may"]), "role contract");
    expect(() => requireList(emptyMay, "may", "src")).toThrow("may must not be empty");

    const missingField = readFrontmatter(
      ["role: implementer"],
      "src",
      new Set(["may"]),
      "role contract",
    );
    expect(() => requireList(missingField, "may", "src")).toThrow("missing key: may");
  });

  test("parseRoleContract parses valid contracts and generates correct cryptographic digests", () => {
    const bytes = doc(validImplementer);
    const contract: RoleContract = parseRoleContract(bytes, "implementer.md");
    expect(contract.role).toBe("implementer");
    expect(contract.tier).toBe(3);
    expect(contract.may).toEqual([
      "Claim a ready task",
      "Modify designated workspace files within lease",
    ]);
    expect(contract.must_not).toEqual(["Break repository invariants"]);
    expect(contract.commands).toEqual(["task:claim", "task:submit"]);
    expect(contract.spawns).toEqual(["sub-implementer"]);
    expect(contract.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("parseRoleContract enforces strict tier validation", () => {
    expect(parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: 0")), "src").tier).toBe(
      0,
    );
    expect(parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: 2")), "src").tier).toBe(
      2,
    );
    expect(
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: independent")), "src").tier,
    ).toBe(3);

    expect(() =>
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: 4")), "src"),
    ).toThrow("tier must be an integer from 0 to 3");
    expect(() =>
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: -1")), "src"),
    ).toThrow("tier must be an integer from 0 to 3");
    expect(() =>
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: 1.5")), "src"),
    ).toThrow("tier must be an integer from 0 to 3");
    expect(() =>
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: 0x2")), "src"),
    ).toThrow("tier must be an integer from 0 to 3");
    expect(() =>
      parseRoleContract(doc(validImplementer.replace("tier: 3", "tier: high")), "src"),
    ).toThrow("tier must be an integer from 0 to 3");
  });

  test("parseRoleContract enforces validator domain and command confinement rules", () => {
    const validatorFrontmatter = [
      "role: validator",
      "tier: independent",
      "domain: code-quality",
      "may:",
      "  - Review pull requests",
      "must_not:",
      "  - Execute arbitrary writes",
      "commands:",
      "  - finding:get",
      "  - report:get",
      "spawns: []",
    ].join("\n");

    const contract = parseRoleContract(
      doc(validatorFrontmatter, "# Validator\n\nReview code."),
      "validator.md",
    );
    expect(contract.role).toBe("validator");
    expect(contract.domain).toBe("code-quality");
    expect(contract.tier).toBe(3);

    expect(() =>
      parseRoleContract(doc(validImplementer + "\ndomain: code-quality"), "src"),
    ).toThrow("domain is only valid for validator roles");

    expect(() =>
      parseRoleContract(
        doc(validatorFrontmatter.replace("domain: code-quality", "domain: invalid-domain")),
        "src",
      ),
    ).toThrow("domain is not a recognized validator domain");

    const cognitiveWithRunExec = [
      "role: validator",
      "tier: 3",
      "may:",
      "  - Check plan validity",
      "must_not:",
      "  - Execute shell commands",
      "commands:",
      "  - run:exec",
      "spawns: []",
    ].join("\n");

    expect(() => parseRoleContract(doc(cognitiveWithRunExec), "src")).toThrow(
      "cognitive validator role validator must not declare run:exec in commands",
    );

    const mechanicWithRunExec = [
      "role: mechanic-validator",
      "tier: 3",
      "may:",
      "  - Run test commands",
      "must_not:",
      "  - Edit source code",
      "commands:",
      "  - run:exec",
      "spawns: []",
    ].join("\n");

    const mechContract = parseRoleContract(doc(mechanicWithRunExec), "src");
    expect(mechContract.role).toBe("mechanic-validator");
    expect(mechContract.commands).toContain("run:exec");
    expect(isMechanicValidatorContract(mechContract)).toBe(true);
    expect(isCognitiveValidatorContract(mechContract)).toBe(false);
  });

  test("parseRoleContract rejects self-spawning and unknown spawn roles", () => {
    const selfSpawn = validImplementer.replace(
      "spawns:\n  - sub-implementer",
      "spawns:\n  - implementer",
    );
    expect(() => parseRoleContract(doc(selfSpawn), "src")).toThrow("a role may not spawn itself");

    const unknownSpawn = validImplementer.replace(
      "spawns:\n  - sub-implementer",
      "spawns:\n  - phantom-role",
    );
    expect(() => parseRoleContract(doc(unknownSpawn), "src")).toThrow(
      "spawns names an unknown role",
    );
  });

  test("parseChecklist validates document structure, domains, prefixes, and severity levels", () => {
    const validItem = [
      "## CQ-CLEAN-001",
      "rule: Zero any types",
      "rationale: Type safety is required across all modules",
      "how-to-check: Run typescript compiler and search for any",
      "severity: critical",
      "sources:",
      "  - repo-invariants.md",
    ].join("\n");

    const bytes = checklistDoc("code-quality", "Code Quality Rules", validItem);
    const checklist: Checklist = parseChecklist(bytes, "code-quality.md");
    expect(checklist.domain).toBe("code-quality");
    expect(checklist.title).toBe("Code Quality Rules");
    expect(checklist.items).toHaveLength(1);
    expect(checklist.items[0]?.id).toBe("CQ-CLEAN-001");
    expect(checklist.items[0]?.severity).toBe("critical");
    expect(checklist.items[0]?.sources).toEqual(["repo-invariants.md"]);
    expect(checklist.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    expect(() =>
      parseChecklist(encoder.encode("Missing H1\nDomain: code-quality\n"), "src"),
    ).toThrow("document does not open with an H1 title");
    expect(() => parseChecklist(encoder.encode("# Title\nInvalid domain line\n"), "src")).toThrow(
      "second line must be `Domain: <slug>`",
    );
    expect(() =>
      parseChecklist(encoder.encode("# Title\nDomain: unknown-domain\n"), "src"),
    ).toThrow("unrecognized domain");
    expect(() =>
      parseChecklist(encoder.encode("# Title\nDomain: code-quality\n\nNo items"), "src"),
    ).toThrow("document declares no checklist items");

    const badPrefix = checklistDoc(
      "code-quality",
      "Title",
      validItem.replace("CQ-CLEAN-001", "SEC-CLEAN-001"),
    );
    expect(() => parseChecklist(badPrefix, "src")).toThrow(
      `item id SEC-CLEAN-001 does not carry the code-quality prefix ${DOMAIN_ID_PREFIX["code-quality"]}-`,
    );

    const badSeverity = checklistDoc(
      "code-quality",
      "Title",
      validItem.replace("severity: critical", "severity: trivial"),
    );
    expect(() => parseChecklist(badSeverity, "src")).toThrow(
      "severity must be critical, important or minor",
    );

    const emptySources = checklistDoc(
      "code-quality",
      "Title",
      validItem.replace("sources:\n  - repo-invariants.md", "sources: []"),
    );
    expect(() => parseChecklist(emptySources, "src")).toThrow("sources must not be empty");

    const duplicateId = checklistDoc("code-quality", "Title", `${validItem}\n\n${validItem}`);
    expect(() => parseChecklist(duplicateId, "src")).toThrow("duplicate item id: CQ-CLEAN-001");
  });

  test("extractValidatorDomainSection accurately isolates target domain sub-contracts", () => {
    const compositeManifest = [
      "---",
      "role: validator",
      "domain: code-quality",
      "commands: [finding:get]",
      "spawns: []",
      "may: [Analyze code quality]",
      "must_not: [Bypass linters]",
      "---",
      "# Code Quality Validator",
      "",
      "---",
      "role: validator",
      "domain: security",
      "commands: [finding:get]",
      "spawns: []",
      "may: [Audit threat vectors]",
      "must_not: [Expose credentials]",
      "---",
      "# Security Validator",
    ].join("\n");

    const cqSection = extractValidatorDomainSection(compositeManifest, "code-quality");
    expect(cqSection).not.toBeNull();
    expect(cqSection).toContain("domain: code-quality");
    expect(cqSection).toContain("Analyze code quality");

    const secSection = extractValidatorDomainSection(compositeManifest, "security");
    expect(secSection).not.toBeNull();
    expect(secSection).toContain("domain: security");
    expect(secSection).toContain("Audit threat vectors");

    const uiSection = extractValidatorDomainSection(compositeManifest, "ui-design");
    expect(uiSection).toBeNull();
  });
});
