import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("Documentation Separation & Boundary Invariant Unit Tests", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const rootDocsDir = join(repoRoot, "docs");
  const skillDocsDir = join(repoRoot, "orchestrating-long-tasks", "docs");
  const capsulesDir = join(repoRoot, ".capsules");

  const expectedNotice = [
    "> [!IMPORTANT]",
    "> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.",
  ].join("\n");

  it("verifies root docs/planning directory is completely purged and does not exist", () => {
    const planningDir = join(rootDocsDir, "planning");
    const exists = existsSync(planningDir);
    if (exists) {
      const contents = readdirSync(planningDir);
      expect(contents.length).toBe(0);
    } else {
      expect(exists).toBe(false);
    }
  });

  it("verifies root docs/ directory contains only repo-level charters and system guidelines", () => {
    expect(existsSync(rootDocsDir)).toBe(true);

    function collectFiles(dir: string, base: string = ""): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relPath = base ? `${base}/${entry}` : entry;
        if (statSync(fullPath).isDirectory()) {
          results.push(...collectFiles(fullPath, relPath));
        } else {
          results.push(relPath);
        }
      }
      return results;
    }

    const docFiles = collectFiles(rootDocsDir);
    expect(docFiles.length).toBeGreaterThan(0);

    // Ensure no planning files or ephemeral scratch exist under root docs/
    for (const file of docFiles) {
      expect(file.startsWith("planning/")).toBe(false);
      expect(file.includes("scratch")).toBe(false);

      const isValidCharterOrDoc =
        file.startsWith("charter-") ||
        file.startsWith("mind/") ||
        file.endsWith(".md");

      expect(isValidCharterOrDoc).toBe(true);
    }
  });

  it("verifies all markdown files in orchestrating-long-tasks/docs/ contain the Human Developer warning header", () => {
    expect(existsSync(skillDocsDir)).toBe(true);

    function collectMarkdownFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          results.push(...collectMarkdownFiles(fullPath));
        } else if (entry.endsWith(".md")) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const mdFiles = collectMarkdownFiles(skillDocsDir);
    // There should be the README.md and 30 chapter files across 10 sections
    expect(mdFiles.length).toBeGreaterThanOrEqual(30);

    for (const filePath of mdFiles) {
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain(expectedNotice);
      expect(content).toContain("HUMAN DEVELOPER REFERENCE ONLY");
      expect(content).toContain("Autonomous LLM runtime subagents MUST NOT ingest these files directly into context");
    }
  });

  it("verifies runtime plans and execution state live strictly under .capsules/", () => {
    expect(existsSync(capsulesDir)).toBe(true);

    const entries = readdirSync(capsulesDir);
    expect(entries.length).toBeGreaterThan(0);

    // Verify capsules have expected structure for runs that have planned tasks
    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const runPath = join(capsulesDir, entry);
      if (statSync(runPath).isDirectory()) {
        const runEntries = readdirSync(runPath);
        expect(runEntries).toContain("manifest.json");
        expect(runEntries).toContain("prompt.md");
      }
    }
  });
});
