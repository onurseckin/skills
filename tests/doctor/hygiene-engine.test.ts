import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
} from "../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createWorkspace(): string {
  const root = join(
    tmpdir(),
    `hygiene-doc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  testRoots.push(root);
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "README.md"), "# Doctor Test");
  writeFileSync(join(root, "tsconfig.json"), "{}");
  return root;
}

describe("Doctor Repository Hygiene Diagnostic Engine", () => {
  it("reports healthy status on clean repository workspace", () => {
    const root = createWorkspace();
    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.scrubbedFiles).toHaveLength(0);
  });

  it("detects unapproved root files, loose scratch scripts and unapproved directories", () => {
    const root = createWorkspace();
    writeFileSync(join(root, "fix-bug.ts"), "const a = 1;");
    writeFileSync(join(root, "loose.sh"), "#!/bin/bash");
    writeFileSync(join(root, "rogue.data"), "raw");
    mkdirSync(join(root, "unapproved_dir"), { recursive: true });

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBe(4);

    const types = result.violations.map((v) => v.violationType);
    expect(types).toContain("UNCONFINED_SCRATCH_SCRIPT");
    expect(types).toContain("UNAPPROVED_ROOT_FILE");
    expect(types).toContain("UNAPPROVED_ROOT_DIR");
  });

  it("detects static package runtime pollution under olt/", () => {
    const root = createWorkspace();
    const oltDir = join(root, "olt");
    const covDir = join(oltDir, "coverage");
    mkdirSync(covDir, { recursive: true });
    writeFileSync(join(covDir, "lcov.info"), "TN:");
    writeFileSync(join(oltDir, "defects.jsonl"), "{}");

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    const staticViolations = result.violations.filter(
      (v) => v.violationType === "STATIC_PACKAGE_RUNTIME_POLLUTION",
    );
    expect(staticViolations.length).toBe(2);
  });

  it("quarantines offending files and returns scrubbed file paths when fix=true", () => {
    const root = createWorkspace();
    writeFileSync(join(root, "fix-temp.ts"), "export const x = 10;");
    writeFileSync(join(root, "unapproved.tmp"), "temp");

    const firstResult = checkRepositoryHygiene({ repoRoot: root, fix: true });
    expect(firstResult.passed).toBe(false);
    expect(firstResult.scrubbedFiles.length).toBe(2);
    expect(existsSync(join(root, "fix-temp.ts"))).toBe(false);
    expect(existsSync(join(root, "unapproved.tmp"))).toBe(false);

    const secondResult = checkRepositoryHygiene({ repoRoot: root });
    expect(secondResult.passed).toBe(true);
    expect(secondResult.violations).toHaveLength(0);
  });

  it("purgeOrphanedScratch moves loose root files to scratch/orphaned/", () => {
    const root = createWorkspace();
    writeFileSync(join(root, "loose-scratch.ts"), "export const s = 1;");
    writeFileSync(join(root, "junk.txt"), "junk");

    const scrubbed = purgeOrphanedScratch(root);
    expect(scrubbed).toContain("loose-scratch.ts");
    expect(scrubbed).toContain("junk.txt");
    expect(existsSync(join(root, "loose-scratch.ts"))).toBe(false);
    expect(existsSync(join(root, "junk.txt"))).toBe(false);
    expect(existsSync(join(root, "scratch", "orphaned"))).toBe(true);
    expect(existsSync(join(root, "package.json"))).toBe(true);
    expect(existsSync(join(root, "README.md"))).toBe(true);
  });

  it("verifies hygiene-engine adheres to zero comments and physical line limits", () => {
    const filePath = join(process.cwd(), "olt/scripts/src/reporting/doctor/hygiene-engine.ts");
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);
    expect(content).not.toMatch(/\/\//);
    expect(content).not.toMatch(/\/\*/);
    expect(content).not.toContain("export *");
  });
});
