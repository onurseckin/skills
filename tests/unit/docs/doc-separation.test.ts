import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("Documentation Separation & Boundary Invariant Unit Tests", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const rootDocsDir = join(repoRoot, "docs");
  const skillDocsDir = join(repoRoot, "olt", "docs");
  const capsulesDir = join(repoRoot, ".olt");
  const mindDir = join(repoRoot, "olt", "mind");
  const mindRolePath = join(repoRoot, "olt", "agents", "mind.yaml");

  it("verifies olt/docs directory is completely removed and does not exist", () => {
    expect(existsSync(skillDocsDir)).toBe(false);
  });

  it("verifies root docs/ directory contains strictly repository-wide skill collection guidelines and human educational docs", () => {
    expect(existsSync(rootDocsDir)).toBe(true);

    const allowedEntries = new Set([
      "README.md",
      "SKILL_COLLECTION_GUIDELINES.md",
      "CHARTER.md",
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

  it("verifies Mind charter and definitions reside inside repo", () => {
    expect(existsSync(mindRolePath)).toBe(true);

    const charterPath = join(repoRoot, "docs", "CHARTER.md");
    expect(existsSync(charterPath)).toBe(true);
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
        if (entry.startsWith("run-")) {
          const runEntries = readdirSync(runPath);
          expect(runEntries).toContain("manifest.json");
          expect(runEntries).toContain("prompt.md");
        }
      }
    }
  });
});
