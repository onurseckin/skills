import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { findRepoRoot, resolveSkillHomeRepo } from "../../../olt/scripts/src/core/shared/paths.ts";

describe("findRepoRoot refuses to guess", () => {
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => mockDirs.has(String(p))),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
        String(p)) as unknown as typeof fs.realpathSync),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("throws a HarnessError instead of returning a guessed root when no anchor exists", () => {
    const isolated = "/virtual-paths-no-anchor";
    mockDirs.add(isolated);
    let caught: unknown;
    try {
      findRepoRoot(isolated);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HarnessError);
    const error = caught as HarnessError;
    expect(error.code).toBe("PATH_SAFETY");
    expect(error.message).toContain("refusing to guess a repo root");
    expect(error.message).toContain(isolated);
  });

  it("still resolves normally when an anchor is present", () => {
    const root = "/virtual-paths-with-anchor";
    mockDirs.add(root);
    mockDirs.add(join(root, ".git"));
    const nested = join(root, "a", "b", "c");
    mockDirs.add(nested);
    expect(findRepoRoot(nested)).toBe(root);
  });
});

describe("resolveSkillHomeRepo precedence", () => {
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => mockDirs.has(String(p))),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
        String(p)) as unknown as typeof fs.realpathSync),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("lets an explicitly supplied currentRepoRoot win over OLT_SKILL_HOME_REPO and the global config", () => {
    const base = "/virtual-skill-home-precedence";
    const explicitRoot = join(base, "explicit-repo");
    const envRoot = join(base, "env-repo");
    mockDirs.add(explicitRoot);
    mockDirs.add(envRoot);

    const previousEnv = process.env["OLT_SKILL_HOME_REPO"];
    process.env["OLT_SKILL_HOME_REPO"] = envRoot;
    try {
      expect(resolveSkillHomeRepo(explicitRoot)).toBe(resolve(explicitRoot));
    } finally {
      if (previousEnv === undefined) {
        delete process.env["OLT_SKILL_HOME_REPO"];
      } else {
        process.env["OLT_SKILL_HOME_REPO"] = previousEnv;
      }
    }
  });

  it("falls back to OLT_SKILL_HOME_REPO when no currentRepoRoot is supplied", () => {
    const base = "/virtual-skill-home-env-fallback";
    const envRoot = join(base, "env-repo");
    mockDirs.add(envRoot);

    const previousEnv = process.env["OLT_SKILL_HOME_REPO"];
    process.env["OLT_SKILL_HOME_REPO"] = envRoot;
    try {
      expect(resolveSkillHomeRepo()).toBe(resolve(envRoot));
    } finally {
      if (previousEnv === undefined) {
        delete process.env["OLT_SKILL_HOME_REPO"];
      } else {
        process.env["OLT_SKILL_HOME_REPO"] = previousEnv;
      }
    }
  });
});
