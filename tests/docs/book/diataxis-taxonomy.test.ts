import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("OLT Book System - Diátaxis 4-Quadrant Framework & Canonical Guidelines", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const bookDir = join(repoRoot, "docs", "book");
  const canonicalGuidelinesPath = join(repoRoot, "olt", "docs", "guidelines.md");
  const rootSkillGuidelinesPath = join(repoRoot, "docs", "SKILL_COLLECTION_GUIDELINES.md");
  const oltGuidelinesPath = join(repoRoot, "docs", "olt", "GUIDELINES.md");

  it("verifies canonical guidelines in olt/docs/ and clean referencing by legacy entrypoints", () => {
    expect(existsSync(canonicalGuidelinesPath)).toBe(true);
    expect(statSync(canonicalGuidelinesPath).size).toBeGreaterThan(1000);

    const canonicalContent = readFileSync(canonicalGuidelinesPath, "utf-8");
    expect(canonicalContent).toContain("Canonical Authoring and Governance Guidelines");

    expect(existsSync(rootSkillGuidelinesPath)).toBe(true);
    const rootSkillContent = readFileSync(rootSkillGuidelinesPath, "utf-8");
    expect(rootSkillContent).toContain("olt/docs/guidelines.md");

    expect(existsSync(oltGuidelinesPath)).toBe(true);
    const oltGuidelinesContent = readFileSync(oltGuidelinesPath, "utf-8");
    expect(oltGuidelinesContent).toContain("olt/docs/guidelines.md");
  });

  it("verifies Diataxis 4-quadrant adherence and taxonomy coverage", () => {
    const bookReadme = readFileSync(join(bookDir, "README.md"), "utf-8");
    expect(bookReadme).toContain("Diátaxis");
    expect(bookReadme).toContain("Tutorials");
    expect(bookReadme).toContain("Explanations");
    expect(bookReadme).toContain("How-To Guides");
    expect(bookReadme).toContain("Reference");

    const canonicalGuidelines = readFileSync(canonicalGuidelinesPath, "utf-8");
    expect(canonicalGuidelines).toContain("Diataxis");
  });
});
