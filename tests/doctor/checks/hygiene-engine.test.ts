import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  checkRepositoryHygiene,
  purgeOrphanedScratch,
} from "../../../olt/scripts/src/reporting/doctor/hygiene-engine.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const hygieneEngineSuiteName = "Doctor Repository Hygiene Diagnostic Engine";

function createVirtualWorkspace(vfs: VirtualMemoryFS): string {
  const root = "/virtual/workspace";
  vfs.mkdirSync(root, { recursive: true });
  vfs.writeFileSync(join(root, "package.json"), "{}");
  vfs.writeFileSync(join(root, "README.md"), "# Doctor Test");
  vfs.writeFileSync(join(root, "tsconfig.json"), "{}");
  return root;
}

describe(hygieneEngineSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session?.cleanup();
    session = null;
  });

  it("reports healthy status on clean repository workspace", () => {
    const root = createVirtualWorkspace(vfs);

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.scrubbedFiles).toHaveLength(0);
  });

  it("detects unapproved root files, loose scratch scripts and unapproved directories", () => {
    const root = createVirtualWorkspace(vfs);

    vfs.writeFileSync(join(root, "fix-bug.ts"), "const a = 1;");
    vfs.writeFileSync(join(root, "loose.sh"), "#!/bin/bash");
    session?.chmodSync(join(root, "loose.sh"), 0o755);
    vfs.writeFileSync(join(root, "rogue.data"), "raw");
    vfs.mkdirSync(join(root, "unapproved_dir"), { recursive: true });

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBe(4);

    const types = result.violations.map((v) => v.violationType);
    expect(types).toContain("UNCONFINED_SCRATCH_SCRIPT");
    expect(types).toContain("UNAPPROVED_ROOT_FILE");
    expect(types).toContain("UNAPPROVED_ROOT_DIR");
  });

  it("detects static package runtime pollution under olt/", () => {
    const root = createVirtualWorkspace(vfs);

    const oltDir = join(root, "olt");
    const covDir = join(oltDir, "coverage");
    vfs.mkdirSync(covDir, { recursive: true });
    vfs.writeFileSync(join(covDir, "lcov.info"), "TN:");
    vfs.writeFileSync(join(oltDir, "defects.jsonl"), "{}");

    const result = checkRepositoryHygiene({ repoRoot: root });
    expect(result.passed).toBe(false);
    const staticViolations = result.violations.filter(
      (v) => v.violationType === "STATIC_PACKAGE_RUNTIME_POLLUTION",
    );
    expect(staticViolations.length).toBe(2);
  });

  it("quarantines offending files and returns scrubbed file paths when fix=true", () => {
    const root = createVirtualWorkspace(vfs);

    vfs.writeFileSync(join(root, "fix-temp.ts"), "export const x = 10;");
    vfs.writeFileSync(join(root, "unapproved.tmp"), "temp");

    const firstResult = checkRepositoryHygiene({ repoRoot: root, fix: true });
    expect(firstResult.passed).toBe(false);
    expect(firstResult.scrubbedFiles.length).toBe(2);
    expect(vfs.existsSync(join(root, "fix-temp.ts"))).toBe(false);
    expect(vfs.existsSync(join(root, "unapproved.tmp"))).toBe(false);

    const secondResult = checkRepositoryHygiene({ repoRoot: root });
    expect(secondResult.passed).toBe(true);
    expect(secondResult.violations).toHaveLength(0);
  });

  it("purgeOrphanedScratch moves loose root files to scratch/orphaned/", () => {
    const root = createVirtualWorkspace(vfs);

    vfs.writeFileSync(join(root, "loose-scratch.ts"), "export const s = 1;");
    vfs.writeFileSync(join(root, "junk.txt"), "junk");

    const scrubbed = purgeOrphanedScratch(root);
    expect(scrubbed).toContain("loose-scratch.ts");
    expect(scrubbed).toContain("junk.txt");
    expect(vfs.existsSync(join(root, "loose-scratch.ts"))).toBe(false);
    expect(vfs.existsSync(join(root, "junk.txt"))).toBe(false);
    expect(vfs.existsSync(join(root, "scratch", "orphaned"))).toBe(true);
    expect(vfs.existsSync(join(root, "package.json"))).toBe(true);
    expect(vfs.existsSync(join(root, "README.md"))).toBe(true);
  });
});
