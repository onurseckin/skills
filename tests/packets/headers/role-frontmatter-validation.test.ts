import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  parseRoleContract,
  parseChecklist,
  extractValidatorDomainSection,
  isCognitiveValidatorContract,
  isMechanicValidatorContract,
  loadValidatorDomainContract,
  DOMAIN_ID_PREFIX,
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

describe("role contract boundary & checklist validation", () => {
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

  test("loadValidatorDomainContract parses matched section when manifest instructions embed domain contract", () => {
    const yamlManifestWithSection = [
      "role: validator",
      "tier: 3",
      "permissions:",
      "  may: [Analyze]",
      "  must_not: [Bypass]",
      "  commands: [finding:get]",
      "  spawns: []",
      "instructions: |",
      "  ---",
      "  role: validator",
      "  tier: 3",
      "  domain: code-quality",
      "  may:",
      "    - Deep code quality review",
      "  must_not:",
      "    - Suppress errors",
      "  commands:",
      "    - finding:get",
      "  spawns: []",
      "  ---",
      "  # Code Quality Validator",
    ].join("\n");

    const validItem = [
      "## CQ-CLEAN-001",
      "rule: Zero any types",
      "rationale: Type safety is required across all modules",
      "how-to-check: Run typescript compiler and search for any",
      "severity: critical",
      "sources:",
      "  - repo-invariants.md",
    ].join("\n");

    const contract = loadValidatorDomainContract("code-quality", (path: string) => {
      if (path.includes("checklists")) {
        return checklistDoc("code-quality", "Code Quality Checklist", validItem);
      }
      return new TextEncoder().encode(yamlManifestWithSection);
    });
    expect(contract.domain).toBe("code-quality");
    expect(contract.may).toContain("Deep code quality review");
  });
});
