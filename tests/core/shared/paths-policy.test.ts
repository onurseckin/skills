import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveGlobalSkillDir,
  resolveSkillHomeRepo,
} from "../../../olt/scripts/src/core/shared/paths.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("paths-policy dynamic resolution and relocation invariants", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let tempBase: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    tempBase = `/virtual/paths-policy-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    vfs.mkdirSync(tempBase, { recursive: true });
    savedEnv = process.env["OLT_SKILL_HOME_REPO"];
    delete process.env["OLT_SKILL_HOME_REPO"];
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env["OLT_SKILL_HOME_REPO"] = savedEnv;
    } else {
      delete process.env["OLT_SKILL_HOME_REPO"];
    }
    session.cleanup();
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
      vfs.mkdirSync(clientRepo, { recursive: true });

      const resolved = resolveSkillHomeRepo(clientRepo);
      expect(resolved).not.toBe(resolve(clientRepo));
      expect(resolved).toBe(resolve("/Users/onurseckinsenoglu/repos/skills"));
    });

    it("overrides resolution when OLT_SKILL_HOME_REPO is set", () => {
      const customEnvRepo = join(tempBase, "custom-env-repo");
      vfs.mkdirSync(customEnvRepo, { recursive: true });

      process.env["OLT_SKILL_HOME_REPO"] = customEnvRepo;

      expect(resolveSkillHomeRepo()).toBe(resolve(customEnvRepo));

      const clientRepo = join(tempBase, "client-repo-with-env");
      vfs.mkdirSync(clientRepo, { recursive: true });
      expect(resolveSkillHomeRepo(clientRepo)).toBe(resolve(customEnvRepo));
    });

    it("resolves skill home repo driven by defect_routing.skill_home_repo_root in policy.json", () => {
      const clientRepo = join(tempBase, "client-with-defect-routing");
      const dotOltDir = join(clientRepo, ".olt");
      vfs.mkdirSync(dotOltDir, { recursive: true });

      const configuredSkillHome = join(tempBase, "routed-skills-home");
      vfs.mkdirSync(configuredSkillHome, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          skill_home_repo_root: configuredSkillHome,
          global_skill_dir: "~/.agents/skills/olt",
          dual_write_enabled: true,
        },
      };
      vfs.writeFileSync(
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
      vfs.mkdirSync(dotOltDir, { recursive: true });

      const configuredSkillHome = join(tempBase, "root-skills-home");
      vfs.mkdirSync(configuredSkillHome, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        skill_home_repo_root: configuredSkillHome,
      };
      vfs.writeFileSync(
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
      vfs.mkdirSync(emptyClient, { recursive: true });
      expect(resolveGlobalSkillDir(emptyClient)).toBe(expectedDefault);
    });

    it("returns configured global skill dir from policy defect_routing with tilde expansion", () => {
      const clientRepo = join(tempBase, "client-with-tilde-dir");
      const dotOltDir = join(clientRepo, ".olt");
      vfs.mkdirSync(dotOltDir, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          global_skill_dir: "~/.custom/agents/skills/olt",
          skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
          dual_write_enabled: true,
        },
      };
      vfs.writeFileSync(
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
      vfs.mkdirSync(dotOltDir, { recursive: true });

      const customGlobalDir = join(tempBase, "custom-global-olt");
      vfs.mkdirSync(customGlobalDir, { recursive: true });

      const policyPayload = {
        schema_version: 1,
        defect_routing: {
          global_skill_dir: customGlobalDir,
          skill_home_repo_root: "/Users/onurseckinsenoglu/repos/skills",
          dual_write_enabled: true,
        },
      };
      vfs.writeFileSync(
        join(dotOltDir, "policy.json"),
        JSON.stringify(policyPayload, null, 2),
        "utf-8",
      );

      const resolved = resolveGlobalSkillDir(clientRepo);
      expect(resolved).toBe(resolve(customGlobalDir));
    });
  });
});
