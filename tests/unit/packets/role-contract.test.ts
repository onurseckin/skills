import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  loadRoleContract,
  parseRoleContract,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";

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
    expect(contract.commands).toContain("task:review");
    expect(contract.must_not.join("\n")).toContain("mandatory adversarial probe");
  });
});
