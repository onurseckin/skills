import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  clearManifestCache,
  CONTRACT_CACHE,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
  MANIFEST_CACHE,
  UNIFIED_CACHE,
} from "../../olt/scripts/src/authority/manifest/loader.ts";
import {
  agentIdToRole,
  agentIdToTier,
  roleToTier,
  type ExecutionTier,
} from "../../olt/scripts/src/authority/thread/role-mapping.ts";
import { validateTierSpawning } from "../../olt/scripts/src/authority/thread/spawning.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "./fixture.ts";

describe("Authority Roles & Contracts Alignment", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
    clearManifestCache();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
    clearManifestCache();
  });

  it("aligns all canonical fleet roles across tier, archetype, and mandate", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/alignment/canonical";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    const canonicalRoles: Array<{
      role: string;
      tier: ExecutionTier;
      archetype: string;
      writeTools: boolean;
    }> = [
      {
        role: "mind",
        tier: 0,
        archetype: "Autonomous Consciousness & Observe-Only Lead",
        writeTools: false,
      },
      {
        role: "orchestrator",
        tier: 1,
        archetype: "Plan Supervisor & Multi-Round Release Manager",
        writeTools: false,
      },
      {
        role: "coordinator",
        tier: 2,
        archetype: "Wave Execution & Lease Manager",
        writeTools: false,
      },
      {
        role: "validator",
        tier: 3,
        archetype: "Adversarial Verifier & Quantitative Gate Inspector",
        writeTools: false,
      },
      {
        role: "validator-ui",
        tier: 3,
        archetype: "Adversarial Verifier & Quantitative Gate Inspector",
        writeTools: false,
      },
      {
        role: "implementer",
        tier: 3,
        archetype: "Scoped Modular Implementer",
        writeTools: true,
      },
      {
        role: "completeness-critic",
        tier: 3,
        archetype: "Run Completeness & Verification Critic",
        writeTools: false,
      },
    ];

    for (const spec of canonicalRoles) {
      vfs.writeFileSync(
        join(agentsDir, `${spec.role}.yaml`),
        `name: "${spec.role}"\nrole: "${spec.role}"\ntier: ${spec.tier}\ntools:\n  enable_write_tools: ${spec.writeTools}\ninterface:\n  display_name: "${spec.role.toUpperCase()} Agent"\n`,
      );

      const model = loadUnifiedAgentModel(spec.role, { agentsDir });
      expect(model.role).toBe(spec.role);
      expect(model.tier).toBe(spec.tier);
      expect(model.archetype).toBe(spec.archetype);
      expect(model.tools.enable_write_tools).toBe(true);
      expect(roleToTier(spec.role)).toBe(spec.tier);
    }
  });

  it("verifies hierarchical spawning boundaries and contract permissions alignment", () => {
    // Tier 0 (Mind) can only spawn Tier 1 (Orchestrator)
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(0, 2).allowed).toBe(false);
    expect(validateTierSpawning(0, 3).allowed).toBe(false);

    // Tier 1 (Orchestrator) can only spawn Tier 2 (Coordinator)
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(1, 1).allowed).toBe(false);
    expect(validateTierSpawning(1, 3).allowed).toBe(false);

    // Tier 2 (Coordinator) can only spawn Tier 3 (Implementer/Validator)
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(2, 1).allowed).toBe(false);
    expect(validateTierSpawning(2, 2).allowed).toBe(false);

    // Tier 3 (Leaf worker) can spawn peer Tier 3 workers
    expect(validateTierSpawning(3, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 2).allowed).toBe(false);
    expect(validateTierSpawning(3, 1).allowed).toBe(false);

    // Verify upward escalation rejection message
    const upwardViolation = validateTierSpawning(3, 1);
    expect(upwardViolation.allowed).toBe(false);
    expect(upwardViolation.reason).toContain("role escalation violation");

    // Verify root skipping rejection message
    const skipViolation = validateTierSpawning(0, 3);
    expect(skipViolation.allowed).toBe(false);
    expect(skipViolation.reason).toContain("cannot directly spawn Tier 3");
  });

  it("handles malformed and zero-byte files gracefully during role and manifest resolution", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/alignment/malformed";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    // Zero byte and corrupted YAML files
    vfs.writeFileSync(join(agentsDir, "corrupt.yaml"), "{ unclosed: [bad yaml");
    vfs.writeFileSync(join(agentsDir, "empty.yml"), "");
    vfs.writeFileSync(
      join(agentsDir, "valid.yaml"),
      'name: "valid"\nrole: "valid"\ntier: 3\ninstructions: "Valid worker"\n',
    );

    // loadRoleContract on corrupt role falls back gracefully to synthetic contract
    const corruptContract = loadRoleContract("corrupt", { agentsDir });
    expect(corruptContract.role).toBe("corrupt");
    expect(corruptContract.tier).toBe(3);
    expect(corruptContract.body).toContain("Synthetic contract loaded");

    // loadUnifiedAgentModel on valid role succeeds despite corrupt neighbors
    const validModel = loadUnifiedAgentModel("valid", { agentsDir });
    expect(validModel.role).toBe("valid");
    expect(validModel.tier).toBe(3);
    expect(validModel.instructions).toBe("Valid worker");
  });

  it("aligns custom domain contracts and maintains frontmatter metadata", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/alignment/domains";
    const rolesDir = join(sandbox, "roles");
    vfs.mkdirSync(rolesDir, { recursive: true });

    vfs.writeFileSync(
      join(rolesDir, "auditor.yaml"),
      [
        'name: "auditor"',
        'role: "auditor"',
        "tier: 3",
        'domain: "governance"',
        "permissions:",
        "  may:",
        '    - "Inspect audit receipts"',
        '    - "Verify signatures"',
        "  must_not:",
        '    - "Directly modify source code"',
        "  commands:",
        '    - "audit:verify"',
        '    - "whoami"',
        'instructions: "# Auditor Directives\\nEnforce compliance strictly."',
      ].join("\n"),
    );

    const contract = loadRoleContract("auditor", { agentsDir: rolesDir });
    expect(contract.role).toBe("auditor");
    expect(contract.tier).toBe(3);
    expect(contract.domain).toBe("governance");
    expect(contract.may).toContain("Inspect audit receipts");
    expect(contract.mustNot).toContain("Directly modify source code");
    expect(contract.commands).toContain("audit:verify");

    const model = loadUnifiedAgentModel("auditor", { agentsDir: rolesDir });
    expect(model.domain).toBe("governance");
    expect(model.may).toContain("Inspect audit receipts");
    expect(model.mustNot).toContain("Directly modify source code");
  });

  it("resolves tier conflict by giving precedence to manifest tier over contract tier", () => {
    const vfs = getVirtualAuthorityFS();
    const sandbox = "/virtual/alignment/tier-conflict";
    const agentsDir = join(sandbox, "agents");
    vfs.mkdirSync(agentsDir, { recursive: true });

    vfs.writeFileSync(
      join(agentsDir, "hybrid.yaml"),
      'name: "hybrid"\nrole: "hybrid"\ntier: 2\ninstructions: "Hybrid role instructions"\n',
    );

    const model = loadUnifiedAgentModel("hybrid", { agentsDir });
    expect(model.tier).toBe(2);
    expect(model.archetype).toBe("Wave Execution & Lease Manager");
  });

  it("synthesizes compliant contract and manifest defaults when no role files exist on disk", () => {
    const sandbox = "/virtual/alignment/synthetic";
    const emptyAgentsDir = join(sandbox, "empty-agents");

    const syntheticModel = loadUnifiedAgentModel("synthetic-scout", {
      agentsDir: emptyAgentsDir,
      bypassCache: true,
    });

    expect(syntheticModel.role).toBe("synthetic-scout");
    expect(syntheticModel.tier).toBe(3);
    expect(syntheticModel.archetype).toBe("Autonomous Worker");
    expect(syntheticModel.may.length).toBeGreaterThan(0);
    expect(syntheticModel.mustNot.length).toBeGreaterThan(0);
    expect(syntheticModel.commands).toContain("whoami");
    expect(syntheticModel.roleContractBody).toContain("Synthetic contract loaded");
  });

  it("correctly identifies agent IDs and maps to canonical tiers and roles", () => {
    expect(agentIdToTier("mind_pulse-001")).toBe(0);
    expect(agentIdToRole("mind_pulse-001")).toBe("mind");

    expect(agentIdToTier("orchestrator_plan-91")).toBe(1);
    expect(agentIdToRole("orchestrator_plan-91")).toBe("orchestrator");

    expect(agentIdToTier("coordinator_wave-2")).toBe(2);
    expect(agentIdToRole("coordinator_wave-2")).toBe("coordinator");

    expect(agentIdToTier("implementer_task-101-fix")).toBe(3);
    expect(agentIdToRole("implementer_task-101-fix")).toBe("implementer");

    expect(agentIdToTier("validator_task-101-verify")).toBe(3);
    expect(agentIdToRole("validator_task-101-verify")).toBe("validator");
  });
});
