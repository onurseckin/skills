import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { VerbatimRoleInjector } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("VerbatimRoleInjector - Core Resolution & Manifest Loading", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  describe("resolveManifestPath", () => {
    it("resolves valid manifests from olt/agents/mind.yaml and olt/agents/orchestrator.yaml", () => {
      const mindPath = VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "mind");
      expect(mindPath).toBe(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"));

      const orchPath = VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, "orchestrator");
      expect(orchPath).toBe(resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"));
    });

    it("throws HarnessError with code NOT_FOUND when manifest does not exist", () => {
      const fakeRole = "non-existent-role-99999";

      expect(() => {
        VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, fakeRole);
      }).toThrow(HarnessError);

      try {
        VerbatimRoleInjector.resolveManifestPath(REPO_ROOT, fakeRole);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code as string).toBe("NOT_FOUND");
        expect(harnessErr.message).toContain(
          `Agent manifest for role '${fakeRole}' not found at candidates:`,
        );
      }
    });

    it("resolves candidates in precedence order: olt/agents/*.yaml, olt/agents/*.yml, agents/*.yaml, agents/*.yml", () => {
      const sandbox = "/virtual/role-injector/candidate-precedence";
      const agentsDir = join(sandbox, "agents");
      mkdirSync(agentsDir, { recursive: true });
      const agentsYmlPath = join(agentsDir, "test-role.yml");
      writeFileSync(agentsYmlPath, "name: agents-yml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(agentsYmlPath),
      );

      const agentsYamlPath = join(agentsDir, "test-role.yaml");
      writeFileSync(agentsYamlPath, "name: agents-yaml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(agentsYamlPath),
      );

      const oltAgentsDir = join(sandbox, "olt", "agents");
      mkdirSync(oltAgentsDir, { recursive: true });
      const oltAgentsYmlPath = join(oltAgentsDir, "test-role.yml");
      writeFileSync(oltAgentsYmlPath, "name: olt-agents-yml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(oltAgentsYmlPath),
      );

      const oltAgentsYamlPath = join(oltAgentsDir, "test-role.yaml");
      writeFileSync(oltAgentsYamlPath, "name: olt-agents-yaml\n", "utf-8");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(oltAgentsYamlPath),
      );
    });

    it("falls back to the installed skill role manifest when a product repository has only an owner charter", () => {
      const productRepo = "/virtual/role-injector/owner-charter-global";
      const charterPath = join(productRepo, ".olt", "charter.yaml");
      mkdirSync(join(productRepo, ".olt"), { recursive: true });
      writeFileSync(charterPath, "identity: Product owner charter\n", "utf-8");

      const resolved = VerbatimRoleInjector.resolveManifestPath(productRepo, "mind");
      expect(
        resolved === resolve(REPO_ROOT, "olt", "agents", "mind.yaml") ||
          resolved === resolve(process.env.HOME || "", ".agents/skills/olt/agents/mind.yaml"),
      ).toBe(true);
    });
  });

  describe("loadVerbatimManifestContent", () => {
    it("returns exact string content of manifest without modification", () => {
      const mindContent = VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "mind");
      const expectedMind = readFileSync(resolve(REPO_ROOT, "olt", "agents", "mind.yaml"), "utf-8");
      expect(mindContent).toBe(expectedMind);

      const orchContent = VerbatimRoleInjector.loadVerbatimManifestContent(
        REPO_ROOT,
        "orchestrator",
      );
      const expectedOrch = readFileSync(
        resolve(REPO_ROOT, "olt", "agents", "orchestrator.yaml"),
        "utf-8",
      );
      expect(orchContent).toBe(expectedOrch);
    });

    it("throws HarnessError when loading non-existent manifest", () => {
      expect(() => {
        VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "phantom-role");
      }).toThrow(HarnessError);
    });
  });
});
