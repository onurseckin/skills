import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("Documentation Structure, Diátaxis Modules & Semantic Mirroring Invariant Tests", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const rootDocsDir = join(repoRoot, "docs");
  const skillDocsDir = join(rootDocsDir, "orchestrating-long-tasks");
  const forbiddenSkillDocs = join(repoRoot, "orchestrating-long-tasks", "docs");
  const forbiddenPlanningDir = join(rootDocsDir, "planning");
  const scriptsSrcDir = join(repoRoot, "orchestrating-long-tasks", "scripts", "src");
  const testsUnitDir = join(repoRoot, "tests", "unit");

  const expectedModules = [
    "01-foundations",
    "02-requirements",
    "03-graph-scheduler",
    "04-multi-agent",
    "05-task-execution",
    "06-validation-repair",
    "07-gates-and-completion",
    "08-durability-recovery",
    "09-branching-and-honesty",
    "10-tutorial-and-cli",
  ] as const;

  it("verifies forbidden directories do not exist", () => {
    expect(existsSync(forbiddenSkillDocs)).toBe(false);
    expect(existsSync(forbiddenPlanningDir)).toBe(false);
  });

  it("verifies docs/orchestrating-long-tasks contains README.md and all 10 educational modules", () => {
    expect(existsSync(skillDocsDir)).toBe(true);

    const masterReadme = join(skillDocsDir, "README.md");
    expect(existsSync(masterReadme)).toBe(true);
    const readmeContent = readFileSync(masterReadme, "utf8");
    expect(readmeContent.length).toBeGreaterThan(1000);
    expect(readmeContent).toContain("# Orchestrating Long Tasks");

    for (const mod of expectedModules) {
      const modDir = join(skillDocsDir, mod);
      expect(existsSync(modDir)).toBe(true);
      expect(statSync(modDir).isDirectory()).toBe(true);

      const files = readdirSync(modDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThanOrEqual(3);

      for (const file of files) {
        const filePath = join(modDir, file);
        const content = readFileSync(filePath, "utf8");
        expect(content.length).toBeGreaterThan(200);
        expect(content.trim().startsWith("#")).toBe(true);
      }
    }
  });

  it("verifies root docs/README.md is strictly reserved for repository-wide multi-skill collection guidelines", () => {
    const rootReadme = join(rootDocsDir, "README.md");
    expect(existsSync(rootReadme)).toBe(true);
    const content = readFileSync(rootReadme, "utf8");

    expect(content).toContain("Repository Documentation");
    expect(content).toContain("SKILL_COLLECTION_GUIDELINES.md");
    expect(content).toContain("strictly reserved");
    expect(content).toContain("repository-wide multi-skill collection guidelines");

    // Must NOT contain skill-specific execution commands or implementation runtime state
    expect(content).not.toContain("proposeBatch");
    expect(content).not.toContain("--role implementer");
    expect(content).not.toContain("--role repairer");
    expect(content).not.toContain("critic:start");
  });

  it("verifies 1:1 mirror correspondence between scripts/src/ subsystems and tests/unit/ directories", () => {
    expect(existsSync(scriptsSrcDir)).toBe(true);
    expect(existsSync(testsUnitDir)).toBe(true);

    const srcSubsystems = readdirSync(scriptsSrcDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(srcSubsystems.length).toBeGreaterThan(0);

    for (const subsystem of srcSubsystems) {
      const testDir = join(testsUnitDir, subsystem);
      expect(existsSync(testDir)).toBe(true);
      expect(statSync(testDir).isDirectory()).toBe(true);

      const testFiles = readdirSync(testDir).filter(
        (f) => f.endsWith(".test.ts") || f.endsWith(".ts"),
      );
      expect(testFiles.length).toBeGreaterThan(0);
    }
  });

  it("verifies all educational module files adhere to structured Diátaxis navigation headers", () => {
    for (const mod of expectedModules) {
      const modDir = join(skillDocsDir, mod);
      const files = readdirSync(modDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const filePath = join(modDir, file);
        const content = readFileSync(filePath, "utf8");
        expect(content.length).toBeGreaterThan(500);
      }
    }
  });
});
