import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { findRepoRoot, resolveSkillHomeRepo } from "../../../olt/scripts/src/core/shared/paths.ts";

function makeFixtureRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("findRepoRoot refuses to guess", () => {
  it("throws a HarnessError instead of returning a guessed root when no anchor exists", () => {
    const isolated = makeFixtureRoot("paths-no-anchor-");
    try {
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
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });

  it("still resolves normally when an anchor is present", () => {
    const root = makeFixtureRoot("paths-with-anchor-");
    try {
      mkdirSync(join(root, ".git"));
      const nested = join(root, "a", "b", "c");
      mkdirSync(nested, { recursive: true });
      expect(findRepoRoot(nested)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveSkillHomeRepo precedence", () => {
  it("lets an explicitly supplied currentRepoRoot win over OLT_SKILL_HOME_REPO and the global config", () => {
    const base = makeFixtureRoot("skill-home-precedence-");
    const explicitRoot = join(base, "explicit-repo");
    const envRoot = join(base, "env-repo");
    mkdirSync(explicitRoot, { recursive: true });
    mkdirSync(envRoot, { recursive: true });

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
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("falls back to OLT_SKILL_HOME_REPO when no currentRepoRoot is supplied", () => {
    const base = makeFixtureRoot("skill-home-env-fallback-");
    const envRoot = join(base, "env-repo");
    mkdirSync(envRoot, { recursive: true });

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
      rmSync(base, { recursive: true, force: true });
    }
  });
});
