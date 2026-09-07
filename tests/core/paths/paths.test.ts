import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { findRepoRoot, resolveSkillHomeRepo } from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("findRepoRoot refuses to guess", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("throws a HarnessError instead of returning a guessed root when no anchor exists", () => {
    const isolated = "/virtual-paths-no-anchor";
    vfs.mkdirSync(isolated, { recursive: true });
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
    vfs.mkdirSync(root, { recursive: true });
    vfs.mkdirSync(join(root, ".git"), { recursive: true });
    const nested = join(root, "a", "b", "c");
    vfs.mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(root);
  });
});

describe("resolveSkillHomeRepo precedence", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  it("prioritizes OLT_SKILL_HOME_REPO over currentRepoRoot and global config", () => {
    const base = "/virtual-skill-home-precedence";
    const explicitRoot = join(base, "explicit-repo");
    const envRoot = join(base, "env-repo");
    vfs.mkdirSync(explicitRoot, { recursive: true });
    vfs.mkdirSync(envRoot, { recursive: true });

    const previousEnv = process.env["OLT_SKILL_HOME_REPO"];
    process.env["OLT_SKILL_HOME_REPO"] = envRoot;
    try {
      expect(resolveSkillHomeRepo(explicitRoot)).toBe(resolve(envRoot));
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
    vfs.mkdirSync(envRoot, { recursive: true });

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
