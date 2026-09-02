import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  clearManifestCache,
  CONTRACT_CACHE,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
  MANIFEST_CACHE,
  UNIFIED_CACHE,
} from "../../../olt/scripts/src/authority/manifest/loader.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("ManifestLoader Comprehensive Coverage", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
    clearManifestCache();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
    clearManifestCache();
  });

  it("clears caches and retrieves cached contracts/manifests/models", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/loader/cache-test";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(
      join(agentsDir, "worker.yaml"),
      'name: "worker"\nrole: "worker"\ntier: 3\ninstructions: "Do work"\n',
    );

    const contract1 = loadRoleContract("worker", { agentsDir });
    expect(CONTRACT_CACHE.has("worker")).toBe(true);
    const contract2 = loadRoleContract("worker", { agentsDir });
    expect(contract1).toBe(contract2);

    const manifest1 = loadAgentManifest("worker", { agentsDir });
    expect(MANIFEST_CACHE.has("worker")).toBe(true);
    const manifest2 = loadAgentManifest("worker", { agentsDir });
    expect(manifest1).toBe(manifest2);

    const model1 = loadUnifiedAgentModel("worker", { agentsDir });
    expect(UNIFIED_CACHE.has("worker")).toBe(true);
    const model2 = loadUnifiedAgentModel("worker", { agentsDir });
    expect(model1).toBe(model2);

    clearManifestCache();
    expect(CONTRACT_CACHE.size).toBe(0);
    expect(MANIFEST_CACHE.size).toBe(0);
    expect(UNIFIED_CACHE.size).toBe(0);
  });

  it("loads fallback manifest and synthetic contract when role does not exist on disk", () => {
    const sandbox = "/virtual/loader/fallback-test";
    const agentsDir = join(sandbox, "agents");

    const fallbackManifest = loadAgentManifest("non-existent-agent", { agentsDir });
    expect(fallbackManifest.role).toBe("non-existent-agent");
    expect(fallbackManifest.tier).toBe(3);
    expect(fallbackManifest.interface?.display_name).toBe("NON-EXISTENT-AGENT Agent");

    const fallbackContract = loadRoleContract("phantom-role", { agentsDir });
    expect(fallbackContract.role).toBe("phantom-role");
    expect(fallbackContract.tier).toBe(3);
    expect(fallbackContract.body).toContain("Synthetic contract loaded");
  });

  it("loads contracts from .md and readdir fallback files", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/loader/md-contract";
    const rolesDir = join(sandbox, "roles");
    vfs.mkdirSync(rolesDir, { recursive: true });
    vfs.writeFileSync(
      join(rolesDir, "specialist.yaml"),
      'name: "specialist"\nrole: "specialist"\ntier: 2\ndomain: "core"\ninstructions: "# Specialist Instructions"\n',
    );

    const contract = loadRoleContract("specialist", { agentsDir: rolesDir });
    expect(contract.role).toBe("specialist");
    expect(contract.tier).toBe(2);
    expect(contract.domain).toBe("core");
    expect(contract.body).toContain("# Specialist Instructions");
  });

  it("discovers manifests by scanning directory files in agentsDir", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/loader/readdir-manifest";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });
    vfs.writeFileSync(
      join(agentsDir, "custom-file-name.yaml"),
      'name: "scanner"\nrole: "scanner"\ntier: 3\ninstructions: "Scan files"\n',
    );

    const manifest = loadAgentManifest("scanner", { agentsDir });
    expect(manifest.name).toBe("scanner");
    expect(manifest.role).toBe("scanner");
    expect(manifest.tools?.enable_write_tools).toBe(true);

    const oltAgentsDir = join(sandbox, "skill-root-repo", "olt", "agents");
    vfs.mkdirSync(oltAgentsDir, { recursive: true });
    vfs.writeFileSync(join(oltAgentsDir, "scout.yaml"), 'name: "scout"\nrole: "scout"\n');
    const scoutManifest = loadAgentManifest("scout", {
      skillRoot: join(sandbox, "skill-root-repo"),
    });
    expect(scoutManifest.name).toBe("scout");
  });

  it("loads unified agent models across all role archetypes and tiers", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/loader/archetypes";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    const roles: Array<{ name: string; tier: number; archetype: string }> = [
      {
        name: "mind",
        tier: 0,
        archetype: "Autonomous Consciousness & Observe-Only Lead",
      },
      {
        name: "orchestrator",
        tier: 1,
        archetype: "Plan Supervisor & Multi-Round Release Manager",
      },
      {
        name: "coordinator",
        tier: 2,
        archetype: "Wave Execution & Lease Manager",
      },
      {
        name: "validator",
        tier: 3,
        archetype: "Adversarial Verifier & Quantitative Gate Inspector",
      },
      {
        name: "validator-ui",
        tier: 3,
        archetype: "Adversarial Verifier & Quantitative Gate Inspector",
      },
      {
        name: "implementer",
        tier: 3,
        archetype: "Scoped Modular Implementer",
      },
      {
        name: "repairer",
        tier: 3,
        archetype: "Scoped Modular Implementer",
      },
      {
        name: "completeness-critic",
        tier: 3,
        archetype: "Run Completeness & Verification Critic",
      },
      {
        name: "custom-scout",
        tier: 3,
        archetype: "Autonomous Worker",
      },
    ];

    for (const r of roles) {
      vfs.writeFileSync(
        join(agentsDir, `${r.name}.yaml`),
        `name: "${r.name}"\nrole: "${r.name}"\ntier: ${r.tier}\ninstructions: "Role directive"\n`,
      );
      const model = loadUnifiedAgentModel(r.name, { agentsDir, bypassCache: true });
      expect(model.archetype).toBe(r.archetype);
      expect(model.tier).toBe(r.tier);
    }
  });

  it("lists available roles and manifests with alphabetical ordering and deduplication", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/loader/listing-test";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    vfs.writeFileSync(join(agentsDir, "bravo.yaml"), 'name: "bravo"\n');
    vfs.writeFileSync(join(agentsDir, "alpha.yml"), 'name: "alpha"\n');
    vfs.writeFileSync(join(agentsDir, "charlie.md"), "---\nrole: charlie\n---\n");

    const emptyRoles = listAvailableRoles({ agentsDir: "/non/existent" });
    expect(emptyRoles).toEqual([]);

    const emptyManifests = listAvailableManifests({ agentsDir: "/non/existent" });
    expect(emptyManifests).toEqual([]);

    const roles = listAvailableRoles({ agentsDir });
    expect(roles).toEqual(["alpha", "bravo", "charlie"]);

    const manifests = listAvailableManifests({ agentsDir });
    expect(manifests).toEqual(["alpha", "bravo"]);
  });
});
