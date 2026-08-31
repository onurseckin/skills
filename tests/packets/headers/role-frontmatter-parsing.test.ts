import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  readFrontmatter,
  requireList,
  parseRoleContract,
  type RoleContract,
} from "../../../olt/scripts/src/packets/role-contract.ts";

const encoder = new TextEncoder();

function doc(
  frontmatter: string,
  body = "# Implementer\n\nPerform assigned unit tasks.",
): Uint8Array {
  return encoder.encode(`---\n${frontmatter}\n---\n\n${body}\n`);
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

describe("role contract frontmatter parsing & structure", () => {
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
});
