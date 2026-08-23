import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findRepositoryRoot,
  scanMisplacedCapsulesDirectories,
  verifyStrictRepositoryCapsuleRoot,
} from "../../../olt/scripts/src/doctor/capsule-root.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Capsule Root Doctor Checks - p18 strict repository root confinement", () => {
  test("findRepositoryRoot discovers git repository root", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-repo-root-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, ".olt", "capsules", "run-1"), { recursive: true });

    const discovered = findRepositoryRoot(join(repo, ".olt", "capsules", "run-1"));
    expect(discovered).toBe(repo);
  });

  test("verifyStrictRepositoryCapsuleRoot passes when runRoot is in <repo-root>/.capsules/<run-id>", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-repo-valid-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    const runRoot = join(repo, ".olt", "capsules", "run-valid-1");
    await mkdir(runRoot, { recursive: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(true);
    expect(audit.isAtRepoRoot).toBe(true);
    expect(audit.misplacedCapsules).toHaveLength(0);
    expect(audit.issues).toHaveLength(0);
  });

  test("verifyStrictRepositoryCapsuleRoot flags run capsule when stored outside .capsules/", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-repo-invalid-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    const runRoot = join(repo, "nested", "custom-run");
    await mkdir(runRoot, { recursive: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(false);
    expect(audit.isAtRepoRoot).toBe(false);
    expect(audit.issues.some((i) => i.includes("violates repository root confinement"))).toBe(true);
  });

  test("scanMisplacedCapsulesDirectories detects nested .capsules directories in subfolders", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-repo-nested-"));
    roots.push(repo);
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "packages", "pkg-a", ".olt", "capsules"), { recursive: true });
    await mkdir(join(repo, "submodules", "sub", ".olt", "capsules"), { recursive: true });
    const runRoot = join(repo, ".olt", "capsules", "root-run");
    await mkdir(runRoot, { recursive: true });

    const misplaced = scanMisplacedCapsulesDirectories(repo);
    expect(misplaced.length).toBe(2);
    expect(misplaced.some((p) => p.includes("pkg-a"))).toBe(true);
    expect(misplaced.some((p) => p.includes("submodules"))).toBe(true);

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(false);
    expect(audit.misplacedCapsules.length).toBe(2);
    expect(
      audit.issues.some((i) => i.includes("Misplaced nested .capsules directory detected")),
    ).toBe(true);
  });
});
