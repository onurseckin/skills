import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenarioMarkdown } from "./scenario-loader.test.ts";

describe("Long-Prompt Scenario Contract Verification (LP-1..LP-6)", () => {
  const markdownPath = join(import.meta.dir, "long-prompt.md");
  const content = readFileSync(markdownPath, "utf-8");
  const spec = parseScenarioMarkdown(content);

  it("LP-1: enforces complete source preservation with digest binding", () => {
    expect(spec.assertions.some((a) => a.id === "LP-1")).toBe(true);
    expect(spec.prompt.length).toBeGreaterThan(100);
    expect(spec.prompt).toContain("Preserve this entire request for future agents.");
    expect(content).toContain("LP-1");
    expect(content).toContain("Store immutable prompt bytes and bind their SHA-256");
  });

  it("LP-2: records accurate capture assurance without unverified claims", () => {
    expect(spec.assertions.some((a) => a.id === "LP-2")).toBe(true);
    expect(content).toContain("LP-2");
    expect(content).toContain("verbatim_context_copy");
    expect(content).toContain("recorded-unverified");
  });

  it("LP-3: maps every actionable clause to implementation meaning and proof (R-001..R-016)", () => {
    expect(spec.assertions.some((a) => a.id === "LP-3")).toBe(true);

    const requiredKeys = [
      "R-001",
      "R-002",
      "R-003",
      "R-004",
      "R-005",
      "R-006",
      "R-007",
      "R-008",
      "R-009",
      "R-010",
      "R-011",
      "R-012",
      "R-013",
      "R-014",
      "R-015",
      "R-016",
    ];

    for (const key of requiredKeys) {
      expect(content).toContain(key);
    }
  });

  it("LP-4: prevents overlapping write scopes and serializes shared contracts", () => {
    expect(spec.assertions.some((a) => a.id === "LP-4")).toBe(true);
    expect(content).toContain("LP-4");
    expect(content).toContain("shared.py");
    expect(content).toContain("scripts/cli/**");
    expect(content).toContain("scripts/scheduler/**");
  });

  it("LP-5: refuses completion without independent validator command evidence", () => {
    expect(spec.assertions.some((a) => a.id === "LP-5")).toBe(true);
    expect(content).toContain("LP-5");
    expect(content).toContain("Do not trust workers who merely say tests pass");
    expect(content).toContain("Independent validator command records and structured verdicts");
  });

  it("LP-6: keeps pre-inspection architecture provisional until repository discovery", () => {
    expect(spec.assertions.some((a) => a.id === "LP-6")).toBe(true);
    expect(content).toContain("LP-6");
    expect(content).toContain("provisional");
    expect(content).toContain("Inspect existing conventions before changes");
  });
});
