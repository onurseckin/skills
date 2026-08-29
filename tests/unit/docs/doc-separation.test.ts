import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";

describe("Documentation Separation & Boundary Invariant Unit Tests", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const rootDocsDir = join(repoRoot, "docs");
  const skillDocsDir = join(repoRoot, "olt", "docs");
  const capsulesDir = join(repoRoot, ".olt");
  const mindRolePath = join(repoRoot, "olt", "agents", "mind.yaml");

  it("verifies olt/docs directory is completely removed and does not exist", () => {
    expect(existsSync(skillDocsDir)).toBe(false);
  });

  it("verifies root docs/ directory contains strictly repository-wide skill collection guidelines and human educational docs", () => {
    expect(existsSync(rootDocsDir)).toBe(true);

    const allowedEntries = new Set([
      "README.md",
      "SKILL_COLLECTION_GUIDELINES.md",
      "olt",
      "planning",
      "blueprints",
      "archive",
    ]);
    const entries = readdirSync(rootDocsDir);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(allowedEntries.has(entry)).toBe(true);
    }
  });

  it("verifies Mind manifest SSoT resides in olt/agents/mind.yaml with structured charter block and no markdown charters exist", () => {
    expect(existsSync(mindRolePath)).toBe(true);

    // Verify zero markdown charter files exist in docs/ or olt/
    expect(existsSync(join(repoRoot, "docs", "CHARTER.md"))).toBe(false);
    expect(existsSync(join(repoRoot, "olt", "references", "CHARTER.md"))).toBe(false);

    // Verify mind.yaml contains charter definition
    const mindContent = readFileSync(mindRolePath, "utf-8");
    const parsed = yaml.load(mindContent) as Record<string, unknown>;
    expect(parsed).toBeDefined();
    expect(parsed.charter).toBeDefined();
    const charter = parsed.charter as Record<string, unknown>;
    expect(charter.identity).toBeDefined();
    expect(Array.isArray(charter.goals)).toBe(true);
    expect(Array.isArray(charter.repo_roots)).toBe(true);
  });

  it("verifies runtime plans and execution state live strictly under .olt/", () => {
    expect(existsSync(capsulesDir)).toBe(true);

    const entries = readdirSync(capsulesDir);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const runPath = join(capsulesDir, entry);
      if (statSync(runPath).isDirectory()) {
        if (entry === "archive") {
          const archivedRuns = readdirSync(runPath);
          for (const archived of archivedRuns) {
            if (archived.startsWith(".") || !archived.startsWith("run-")) continue;
            const archivedPath = join(runPath, archived);
            if (statSync(archivedPath).isDirectory()) {
              const archivedEntries = readdirSync(archivedPath);
              expect(archivedEntries).toContain("manifest.json");
              expect(archivedEntries).toContain("prompt.md");
            }
          }
          continue;
        }
      }
    }
  });

  it("verifies canonical reference guides exist under docs/olt/reference/", () => {
    const referenceDir = join(repoRoot, "docs", "olt", "reference");
    expect(existsSync(referenceDir)).toBe(true);
    expect(existsSync(join(referenceDir, "index.md"))).toBe(true);
    expect(existsSync(join(referenceDir, "quickstart.md"))).toBe(true);
    expect(existsSync(join(referenceDir, "health-and-status.md"))).toBe(true);
  });
});
