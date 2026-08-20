import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  loadChecklist,
  parseChecklist,
  resolveChecklistPath,
  VALIDATOR_DOMAINS,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";

const encoder = new TextEncoder();

function item(id = "CQ-STRUCT-001", overrides: Record<string, string> = {}): string {
  const fields: Record<string, string> = {
    rule: "A function has one reason to change",
    rationale: "Mixed concerns make an unrelated diff touch code it does not understand",
    "how-to-check": "Read the diff's file list against its stated summary",
    severity: "important",
    ...overrides,
  };
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return [`## ${id}`, ...lines, "sources:", "  - Clean Code (Robert C. Martin)"].join("\n");
}

function documentText(items: string[], domain = "code-quality"): string {
  return `# Code quality checklist\nDomain: ${domain}\n\nIntro prose.\n\n${items.join("\n\n")}\n`;
}

function document(items: string[], domain = "code-quality"): Uint8Array {
  return encoder.encode(documentText(items, domain));
}

describe("checklist parser", () => {
  test("parses a well-formed document into structured items and digests the bytes", () => {
    const bytes = document([item()]);
    const checklist = parseChecklist(bytes, "checklists/code-quality.md");
    expect(checklist.domain).toBe("code-quality");
    expect(checklist.title).toBe("Code quality checklist");
    expect(checklist.items).toEqual([
      {
        id: "CQ-STRUCT-001",
        rule: "A function has one reason to change",
        rationale: "Mixed concerns make an unrelated diff touch code it does not understand",
        howToCheck: "Read the diff's file list against its stated summary",
        severity: "important",
        sources: ["Clean Code (Robert C. Martin)"],
      },
    ]);
    expect(checklist.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("accepts every declared severity", () => {
    for (const severity of ["critical", "important", "minor"]) {
      const checklist = parseChecklist(document([item("CQ-STRUCT-001", { severity })]), "d.md");
      expect(checklist.items[0]!.severity).toBe(severity);
    }
  });

  test("accepts an alphanumeric category in the id, e.g. accessibility's A11Y", () => {
    const checklist = parseChecklist(document([item("UI-A11Y-001")], "ui-design"), "d.md");
    expect(checklist.items[0]!.id).toBe("UI-A11Y-001");
  });

  test.each([
    ["no H1 title", encoder.encode("Domain: code-quality\n\n" + item())],
    ["missing domain line", encoder.encode(`# Title\n\nIntro\n\n${item()}`)],
    ["unrecognized domain", document([item()], "made-up-domain")],
    ["no items", encoder.encode("# Title\nDomain: code-quality\n\nJust prose, no items.\n")],
    ["malformed id (lowercase)", document(["## cq-struct-001\n" + item().split("\n").slice(1).join("\n")])],
    ["id missing the domain prefix", document([item("UI-STRUCT-001")])],
    ["duplicate id", document([item("CQ-STRUCT-001"), item("CQ-STRUCT-001")])],
    ["missing a required field", document([item("CQ-STRUCT-001", {}).replace("\nseverity: important", "")])],
    [
      "unknown field",
      encoder.encode(
        documentText([item()]).replace("severity: important", "severity: important\nweight: 3"),
      ),
    ],
    ["invalid severity", document([item("CQ-STRUCT-001", { severity: "urgent" })])],
    [
      "empty sources list",
      encoder.encode(documentText([item()]).replace("  - Clean Code (Robert C. Martin)", "")),
    ],
    ["invalid utf-8", Uint8Array.from([0x23, 0x20, 0xff])],
  ])("rejects %s", (_case, bytes) => {
    expect(() => parseChecklist(bytes, "checklists/code-quality.md")).toThrow(/checklist/u);
  });

  test("loads every checked-in domain checklist without error", () => {
    for (const domain of VALIDATOR_DOMAINS) {
      const checklist = loadChecklist(domain);
      expect(checklist.domain).toBe(domain);
      expect(checklist.items.length).toBeGreaterThan(0);
      const ids = checklist.items.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const entry of checklist.items) {
        expect(entry.sources.length).toBeGreaterThan(0);
        expect(entry.rule.trim()).toBe(entry.rule);
      }
    }
  });

  test("resolves a checklist's path under the checklists/ root", () => {
    expect(resolveChecklistPath("code-quality")).toMatch(/checklists\/code-quality\.md$/u);
  });

  // B12.3: "the checklist IS the validator's competence" and asks for "genuinely comprehensive —
  // hundreds of items across the domains". A checklist that quietly shrank back toward a handful of
  // items would still parse and pass every other test here, so the count itself needs its own guard
  // (B8.5: a fix without a regression test is a fix that returns).
  test("each domain checklist stays genuinely comprehensive, and the corpus totals hundreds of items", () => {
    let total = 0;
    for (const domain of VALIDATOR_DOMAINS) {
      const count = loadChecklist(domain).items.length;
      expect(count).toBeGreaterThanOrEqual(30);
      total += count;
    }
    expect(total).toBeGreaterThanOrEqual(180);
  });
});
