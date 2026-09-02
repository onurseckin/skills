import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { VerbatimRoleInjector } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

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
      const vfs = getVirtualAuthorityFS();
      const sandbox = "/virtual/role-injector/candidate-precedence";
      const agentsDir = join(sandbox, "agents");
      vfs.mkdirSync(agentsDir, { recursive: true });
      const agentsYmlPath = join(agentsDir, "test-role.yml");
      vfs.writeFileSync(agentsYmlPath, "name: agents-yml\n");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(agentsYmlPath),
      );

      const agentsYamlPath = join(agentsDir, "test-role.yaml");
      vfs.writeFileSync(agentsYamlPath, "name: agents-yaml\n");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(agentsYamlPath),
      );

      const oltAgentsDir = join(sandbox, "olt", "agents");
      vfs.mkdirSync(oltAgentsDir, { recursive: true });
      const oltAgentsYmlPath = join(oltAgentsDir, "test-role.yml");
      vfs.writeFileSync(oltAgentsYmlPath, "name: olt-agents-yml\n");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(oltAgentsYmlPath),
      );

      const oltAgentsYamlPath = join(oltAgentsDir, "test-role.yaml");
      vfs.writeFileSync(oltAgentsYamlPath, "name: olt-agents-yaml\n");

      expect(VerbatimRoleInjector.resolveManifestPath(sandbox, "test-role")).toBe(
        resolve(oltAgentsYamlPath),
      );
    });

    it("falls back to the installed skill role manifest when a product repository has only an owner charter", () => {
      const vfs = getVirtualAuthorityFS();
      const productRepo = "/virtual/role-injector/owner-charter-global";
      const charterPath = join(productRepo, ".olt", "charter.yaml");
      vfs.mkdirSync(join(productRepo, ".olt"), { recursive: true });
      vfs.writeFileSync(charterPath, "identity: Product owner charter\n");

      const resolved = VerbatimRoleInjector.resolveManifestPath(productRepo, "mind");
      expect(resolved.endsWith("mind.yaml")).toBe(true);
    });
  });

  describe("loadVerbatimManifestContent", () => {
    it("returns exact string content of manifest without modification", () => {
      const mindContent = VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "mind");
      expect(typeof mindContent).toBe("string");
      expect(mindContent).toContain('name: "mind"');

      const orchContent = VerbatimRoleInjector.loadVerbatimManifestContent(
        REPO_ROOT,
        "orchestrator",
      );
      expect(typeof orchContent).toBe("string");
      expect(orchContent).toContain('name: "orchestrator"');
    });

    it("throws HarnessError when loading non-existent manifest", () => {
      expect(() => {
        VerbatimRoleInjector.loadVerbatimManifestContent(REPO_ROOT, "phantom-role");
      }).toThrow(HarnessError);
    });
  });
});
