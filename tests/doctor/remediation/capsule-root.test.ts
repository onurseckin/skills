import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  findRepositoryRoot,
  scanMisplacedCapsulesDirectories,
  verifyStrictRepositoryCapsuleRoot,
} from "../../../olt/scripts/src/reporting/doctor/capsule-root.ts";

export const capsuleRootSuiteName =
  "Capsule Root Doctor Checks - p18 strict repository root confinement";

interface VirtualNode {
  isDir: boolean;
  content?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    if (vfs.has(s)) return true;
    const prefix = `${s}/`;
    for (const k of vfs.keys()) {
      if (k.startsWith(prefix)) return true;
    }
    return false;
  });
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const s = String(p).replace(/\/+$/, "");
    const n = vfs.get(s);
    if (n) {
      return {
        isFile: () => !n.isDir,
        isDirectory: () => n.isDir,
        isSymbolicLink: () => false,
        mode: n.isDir ? 0o755 : 0o644,
        size: 0,
        mtimeMs: Date.now(),
      } as fs.Stats;
    }
    const prefix = `${s}/`;
    for (const k of vfs.keys()) {
      if (k.startsWith(prefix)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false,
          mode: 0o755,
          size: 0,
          mtimeMs: Date.now(),
        } as fs.Stats;
      }
    }
    throw new Error(`ENOENT: ${s}`);
  });
  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
    const dir = String(p).replace(/\/+$/, "");
    const prefix = `${dir}/`;
    const entries = new Map<string, boolean>();
    for (const [k, v] of vfs.entries()) {
      if (k.startsWith(prefix) && k.length > prefix.length) {
        const rest = k.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment && !entries.has(segment)) entries.set(segment, rest.includes("/") || v.isDir);
      }
    }
    const withTypes = typeof options === "object" && options !== null && "withFileTypes" in options;
    if (withTypes) {
      return Array.from(entries.entries()).map(([name, isDir]) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isSymbolicLink: () => false,
      })) as unknown as fs.Dirent[];
    }
    return Array.from(entries.keys()) as unknown as fs.Dirent[];
  });
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));

  spies.push(existsSpy, statSpy, readdirSpy, realpathSpy);
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

describe(capsuleRootSuiteName, () => {
  test("findRepositoryRoot discovers git repository root", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-root-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    vfs.set(join(repo, ".capsules", "run-1"), { isDir: true });

    const discovered = findRepositoryRoot(join(repo, ".capsules", "run-1"));
    expect(discovered).toBe(repo);
  });

  test("verifyStrictRepositoryCapsuleRoot passes when runRoot is in <repo-root>/.capsules/<run-id>", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-valid-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    const runRoot = join(repo, ".capsules", "run-valid-1");
    vfs.set(runRoot, { isDir: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(true);
    expect(audit.isAtRepoRoot).toBe(true);
    expect(audit.misplacedCapsules).toHaveLength(0);
    expect(audit.issues).toHaveLength(0);
  });

  test("verifyStrictRepositoryCapsuleRoot flags run capsule when stored outside .capsules/", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-invalid-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    const runRoot = join(repo, "nested", "custom-run");
    vfs.set(runRoot, { isDir: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(false);
    expect(audit.isAtRepoRoot).toBe(false);
    expect(audit.issues.some((i) => i.includes("violates repository root confinement"))).toBe(true);
  });

  test("scanMisplacedCapsulesDirectories detects nested .capsules directories in subfolders", () => {
    setupVirtualFs();
    const repo = "/virtual/repo-nested-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    vfs.set(join(repo, "packages", "pkg-a", ".capsules"), { isDir: true });
    vfs.set(join(repo, "submodules", "sub", ".capsules"), { isDir: true });
    const runRoot = join(repo, ".capsules", "root-run");
    vfs.set(runRoot, { isDir: true });

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

  test("verifyStrictRepositoryCapsuleRoot passes when runRoot is in <repo-root>/.olt/capsules/<run-id> (canonical location)", () => {
    setupVirtualFs();
    const repo = "/virtual/olt-valid-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    const runRoot = join(repo, ".olt", "capsules", "run-olt-1");
    vfs.set(runRoot, { isDir: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(true);
    expect(audit.isAtRepoRoot).toBe(true);
    expect(audit.misplacedCapsules).toHaveLength(0);
    expect(audit.issues).toHaveLength(0);
  });

  test("scanMisplacedCapsulesDirectories flags a bare, undotted capsules/ directory at repo root", () => {
    setupVirtualFs();
    const repo = "/virtual/bare-capsules-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    vfs.set(join(repo, "capsules", "run-1"), { isDir: true });
    const runRoot = join(repo, ".olt", "capsules", "run-canonical");
    vfs.set(runRoot, { isDir: true });

    const misplaced = scanMisplacedCapsulesDirectories(repo);
    expect(misplaced.some((p) => p === join(repo, "capsules"))).toBe(true);

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(false);
    expect(audit.issues.some((i) => i.includes("Bare") && i.includes(join(repo, "capsules")))).toBe(
      true,
    );
  });

  test("verifyStrictRepositoryCapsuleRoot still accepts the legacy <repo-root>/.capsules/<run-id> location", () => {
    setupVirtualFs();
    const repo = "/virtual/legacy-valid-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    const runRoot = join(repo, ".capsules", "run-legacy-1");
    vfs.set(runRoot, { isDir: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(true);
    expect(audit.isAtRepoRoot).toBe(true);
  });

  test("scanMisplacedCapsulesDirectories does not flag capsule-shaped test fixtures left under coverage/scratch/", () => {
    setupVirtualFs();
    const repo = "/virtual/coverage-noise-1";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    vfs.set(join(repo, "coverage", "scratch", "some-test--fixture", ".olt", "capsules"), {
      isDir: true,
    });
    vfs.set(join(repo, "coverage", "scratch", "other-test--fixture", "capsules"), {
      isDir: true,
    });
    const runRoot = join(repo, ".olt", "capsules", "run-real");
    vfs.set(runRoot, { isDir: true });

    const audit = verifyStrictRepositoryCapsuleRoot(runRoot, repo);
    expect(audit.valid).toBe(true);
    expect(audit.misplacedCapsules).toHaveLength(0);
  });
});
