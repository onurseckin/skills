import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  isCognitiveValidatorContract,
  isMechanicValidatorContract,
  loadRoleContract,
  parseRoleContract,
} from "../../../olt/scripts/src/packets/role-contract.ts";

const encoder = new TextEncoder();

function document(frontmatter: string, body = "# Implementer\n\nDo the leased work."): Uint8Array {
  return encoder.encode(`---\n${frontmatter}\n---\n\n${body}\n`);
}

const valid = [
  "role: implementer",
  "tier: 3",
  "may:",
  "  - Claim a ready task",
  "  - Edit files inside the leased write scope, and only",
  "    inside it",
  "must_not:",
  "  - Touch a path outside the lease",
  "commands:",
  "  - task:claim",
  "  - task:submit",
  "spawns:",
  "  - sub-implementer",
].join("\n");

describe("role contract frontmatter parser", () => {
  test("parses scalars, block lists, wrapped entries, and digests the document bytes", () => {
    const bytes = document(valid);
    const contract = parseRoleContract(bytes, "implementer.md");
    expect(contract.role).toBe("implementer");
    expect(contract.tier).toBe(3);
    expect(contract.may).toEqual([
      "Claim a ready task",
      "Edit files inside the leased write scope, and only inside it",
    ]);
    expect(contract.must_not).toEqual(["Touch a path outside the lease"]);
    expect(contract.commands).toEqual(["task:claim", "task:submit"]);
    expect(contract.spawns).toEqual(["sub-implementer"]);
    expect(contract.text).toBe(new TextDecoder().decode(bytes));
    expect(contract.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("accepts an inline empty list", () => {
    const contract = parseRoleContract(
      document(valid.replace("spawns:\n  - sub-implementer", "spawns: []")),
      "implementer.md",
    );
    expect(contract.spawns).toEqual([]);
  });

  test.each([
    ["no opening fence", encoder.encode("role: implementer\n")],
    ["unterminated frontmatter", encoder.encode("---\nrole: implementer\n")],
    ["no prose", encoder.encode(`---\n${valid}\n---\n`)],
    ["missing key", document(valid.replace("tier: 3\n", ""))],
    ["duplicate key", document(`${valid}\ntier: 2`)],
    ["unknown key", document(`${valid}\nowner: nobody`)],
    ["uncanonical role", document(valid.replace("role: implementer", "role: worker"))],
    ["out of range tier", document(valid.replace("tier: 3", "tier: 9"))],
    ["non-numeric tier", document(valid.replace("tier: 3", "tier: high"))],
    ["hexadecimal tier", document(valid.replace("tier: 3", "tier: 0x3"))],
    ["fractional tier", document(valid.replace("tier: 3", "tier: 3.0"))],
    ["empty required list", document(valid.replace("  - Touch a path outside the lease\n", ""))],
    ["duplicate list entry", document(valid.replace("  - task:submit", "  - task:claim"))],
    ["self spawn", document(valid.replace("  - sub-implementer", "  - implementer"))],
    ["unknown spawn", document(valid.replace("  - sub-implementer", "  - auditor"))],
    ["scalar where a list belongs", document(valid.replace("commands:", "commands: task:claim"))],
    ["orphan list item", document(`  - stray\n${valid}`)],
    ["invalid utf-8", Uint8Array.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0x0a])],
  ])("rejects %s", (_case, bytes) => {
    expect(() => parseRoleContract(bytes, "implementer.md")).toThrow(/role contract/u);
  });

  test("loads the checked-in document for a canonical role", () => {
    const contract = loadRoleContract("validator");
    expect(contract.role).toBe("validator");
    expect(contract.must_not.join("\n").toLowerCase()).toContain("probe round");
  });
});

describe("B12.2: the validator-family domain field", () => {
  test("parses a domain scalar on the validator role and leaves it absent otherwise", () => {
    const withDomain = parseRoleContract(
      document(`${valid.replace("role: implementer", "role: validator")}\ndomain: code-quality`),
      "validator-code-quality.md",
    );
    expect(withDomain.domain).toBe("code-quality");
    const without = parseRoleContract(document(valid), "implementer.md");
    expect(without.domain).toBeUndefined();
  });

  test.each([
    [
      "domain on a non-validator role",
      `${valid}\ndomain: code-quality`,
      /domain is only valid for validator/u,
    ],
    [
      "an unrecognized domain",
      `${valid.replace("role: implementer", "role: validator")}\ndomain: made-up`,
      /domain is not a recognized validator domain/u,
    ],
  ])("rejects %s", (_case, frontmatter, expected) => {
    expect(() => parseRoleContract(document(frontmatter), "d.md")).toThrow(expected);
  });

  test("accepts tier: independent and sets tier to 3", () => {
    const contract = parseRoleContract(
      document(valid.replace("tier: 3", "tier: independent")),
      "implementer.md",
    );
    expect(contract.tier).toBe(3);
  });

  test("rejects cognitive validator declaring run:exec in commands", () => {
    const cogWithExec = document(
      valid
        .replace("role: implementer", "role: validator")
        .replace("commands:\n  - task:claim", "commands:\n  - run:exec\n  - task:claim"),
    );
    expect(() => parseRoleContract(cogWithExec, "validator.md")).toThrow(
      "must not declare run:exec in commands",
    );
  });

  test("isCognitiveValidatorContract and isMechanicValidatorContract helper predicates", () => {
    const valContract = loadRoleContract("validator");
    expect(isCognitiveValidatorContract(valContract)).toBe(true);
    expect(isMechanicValidatorContract(valContract)).toBe(false);

    const mechContract = loadRoleContract("mechanic-validator");
    expect(isCognitiveValidatorContract(mechContract)).toBe(false);
    expect(isMechanicValidatorContract(mechContract)).toBe(true);
  });

  test("loadRoleContract throws when file reading fails", () => {
    expect(() =>
      loadRoleContract("implementer", () => {
        throw new Error("Disk read error");
      }),
    ).toThrow("role contract is unreadable");
  });

  test("loadRoleContract throws when role in contract does not match requested role", () => {
    expect(() =>
      loadRoleContract("implementer", () => {
        return document(valid.replace("role: implementer", "role: validator"));
      }),
    ).toThrow("declares role validator");
  });

  test("rejects cognitive validator declaring run:exec in manifest", () => {
    const yamlManifest = [
      "name: validator",
      "role: validator",
      "tier: 3",
      "permissions:",
      "  may: []",
      "  must_not: []",
      "  commands:",
      "    - run:exec",
      "    - task:review",
      "  spawns: []",
      "instructions: Cognitive validator instructions.",
    ].join("\n");

    expect(() => parseRoleContract(encoder.encode(yamlManifest), "validator.yaml")).toThrow(
      "must not declare run:exec in commands",
    );
  });
});
