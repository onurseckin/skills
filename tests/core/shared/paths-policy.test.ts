import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveGlobalSkillDir,
  resolveSkillHomeRepo,
} from "../../../olt/scripts/src/core/shared/paths.ts";

describe("paths-policy dynamic resolution and relocation invariants", () => {
  let tempBase: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tempBase = mkdtempSync(join(tmpdir(), "paths-policy-test-"));
    savedEnv = process.env["OLT_SKILL_HOME_REPO"];
    delete process.env["OLT_SKILL_HOME_REPO"];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env["OLT_SKILL_HOME_REPO"] = savedEnv;
    } else {
      delete process.env["OLT_SKILL_HOME_REPO"];
    }
    rmSync(tempBase, { recursive: true, force: true });
  });

  describe("resolveSkillHomeRepo", () => {
    it("returns configured skills home repository root by default", () => {
      const resolved = resolveSkillHomeRepo();
      expect(typeof resolved).toBe("string");
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved).toBe(resolve("/Users/onurseckinsenoglu/repos/skills"));
    });

    it("returns configured skills home instead of client repo when clientRepo is passed", () => {
      const clientRepo = join(tempBase, "client-app");
      mkdirSync(clientRepo, { recursive: true });

      const resolved = resolveSkillHomeRepo(clientRepo);
      expect(resolved).not.toBe(resolve(clientRepo));
      expect(resolved).toBe(resolve("/Users/onurseckinsenoglu/repos/skills"));
    });

    it("overrides resolution when OLT_SKILL_HOME_REPO is set", () => {
      const customEnvRepo = join(tempBase, "custom-env-repo");
      mkdirSync(customEnvRepo, { recursive: true });

      process.env["OLT_SKILL_HOME_REPO"] = customEnvRepo;

      expect(resolveSkillHomeRepo()).toBe(resolve(customEnvRepo));

      const clientRepo = join(tempBase, "client-repo-with-env");
      mkdirSync(clientRepo, { recursive: true });
      expect(resolveSkillHomeRepo(clientRepo)).toBe(resolve(customEnvRepo));
    });

    it("resolves skill home repo driven by defect_routing.skill_home_repo_root in policy.json", () => {
      const clientRepo = join(tempBase, "client-with-defect-routing");
      const dotOltDir = join(clientRepo, ".olt");
      mkdirSync(dotOltDir, { recursive: true });

      const configuredSkillHome = join(tempBase, "routed-skills-home");
      mkdirSync(configuredSkillHome, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          skill_home_repo_root: configuredSkillHome,
          global_skill_dir: "~/.agents/skills/olt",
          dual_write_enabled: true,
        },
      };
      writeFileSync(
        join(dotOltDir, "policy.json"),
        JSON.stringify(policyPayload, null, 2),
        "utf-8",
      );

      const resolved = resolveSkillHomeRepo(clientRepo);
      expect(resolved).toBe(resolve(configuredSkillHome));
    });

    it("resolves skill home repo driven by root-level skill_home_repo_root in policy.json", () => {
      const clientRepo = join(tempBase, "client-with-root-skill-home");
      const dotOltDir = join(clientRepo, ".olt");
      mkdirSync(dotOltDir, { recursive: true });

      const configuredSkillHome = join(tempBase, "root-skills-home");
      mkdirSync(configuredSkillHome, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        skill_home_repo_root: configuredSkillHome,
      };
      writeFileSync(
        join(dotOltDir, "policy.json"),
        JSON.stringify(policyPayload, null, 2),
        "utf-8",
      );

      const resolved = resolveSkillHomeRepo(clientRepo);
      expect(resolved).toBe(resolve(configuredSkillHome));
    });
  });

  describe("resolveGlobalSkillDir", () => {
    it("returns default global skill directory when no policy specifies an override", () => {
      const expectedDefault = join(homedir(), ".agents", "skills", "olt");
      expect(resolveGlobalSkillDir()).toBe(expectedDefault);

      const emptyClient = join(tempBase, "empty-client");
      mkdirSync(emptyClient, { recursive: true });
      expect(resolveGlobalSkillDir(emptyClient)).toBe(expectedDefault);
    });

    it("returns configured global skill dir from policy defect_routing with tilde expansion", () => {
      const clientRepo = join(tempBase, "client-with-tilde-dir");
      const dotOltDir = join(clientRepo, ".olt");
      mkdirSync(dotOltDir, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          global_skill_dir: "~/.custom/agents/skills/olt",
          skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
          dual_write_enabled: true,
        },
      };
      writeFileSync(
        join(dotOltDir, "policy.json"),
        JSON.stringify(policyPayload, null, 2),
        "utf-8",
      );

      const resolved = resolveGlobalSkillDir(clientRepo);
      const expected = join(homedir(), ".custom", "agents", "skills", "olt");
      expect(resolved).toBe(expected);
    });

    it("returns configured global skill dir from policy defect_routing with absolute path", () => {
      const clientRepo = join(tempBase, "client-with-abs-dir");
      const dotOltDir = join(clientRepo, ".olt");
      mkdirSync(dotOltDir, { recursive: true });

      const customGlobalDir = join(tempBase, "custom-global-olt");
      mkdirSync(customGlobalDir, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          global_skill_dir: customGlobalDir,
          skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
          dual_write_enabled: true,
        },
      };
      writeFileSync(
        join(dotOltDir, "policy.json"),
        JSON.stringify(policyPayload, null, 2),
        "utf-8",
      );

      const resolved = resolveGlobalSkillDir(clientRepo);
      expect(resolved).toBe(resolve(customGlobalDir));
    });
  });
});
