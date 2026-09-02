import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertValidDynamicRoleSpec,
  buildCommandCheatSheet,
  formatDynamicRoleBody,
  formatDynamicRoleFrontmatter,
  formatDynamicRoleMarkdown,
  validateDynamicRoleSpec,
} from "../../../olt/scripts/src/mind/roles/dynamic/validation.ts";
import type { DynamicRoleSpec } from "../../../olt/scripts/src/mind/roles/dynamic/types.ts";

const validImplementerSpec: DynamicRoleSpec = {
  name: "custom_worker",
  archetype: "tier_3_implementer",
  tier: 3,
  title: "Custom Worker Role",
  summary: "Executes assigned leaf implementations under strict bounds.",
  domain: "core",
  grantedCommands: ["task:claim", "task:submit"],
  permittedActivities: ["Execute unit tests", "Edit source files within lease"],
  prohibitedActions: ["Spawn subagents", "Modify out of lease files"],
  invariants: ["Must maintain clean git state"],
  spawns: [],
  cognitivePillars: ["Zero makework", "Empirical evidence first"],
  writeScopePolicy: "lease_bounded",
  version: 1,
  parentRole: "implementer",
};

describe("Dynamic Roles Validation Coverage Suite", () => {
  it("re-exports buildCommandCheatSheet correctly", () => {
    expect(typeof buildCommandCheatSheet).toBe("function");
  });

  it("validates valid dynamic role specifications and asserts without error", () => {
    const result = validateDynamicRoleSpec(validImplementerSpec);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.roleName).toBe("custom_worker");
    expect(result.tier).toBe(3);
    expect(() => assertValidDynamicRoleSpec(validImplementerSpec)).not.toThrow();
  });

  it("rejects invalid role names, out-of-bounds tiers, and archetype tier mismatches", () => {
    const badNameRes = validateDynamicRoleSpec({
      ...validImplementerSpec,
      name: "123_BadRoleName!",
    });
    expect(badNameRes.valid).toBe(false);
    expect(badNameRes.errors.some((e) => e.includes("is invalid"))).toBe(true);

    const badTierRes = validateDynamicRoleSpec({ ...validImplementerSpec, tier: 4 });
    expect(badTierRes.valid).toBe(false);
    expect(
      badTierRes.errors.some((e) => e.includes("Tier must be an integer between 0 and 3")),
    ).toBe(true);

    const mismatchRes = validateDynamicRoleSpec({
      ...validImplementerSpec,
      archetype: "tier_1_orchestrator",
      tier: 3,
    });
    expect(mismatchRes.valid).toBe(false);
    expect(
      mismatchRes.errors.some((e) =>
        e.includes("expects Tier 1, but specification assigned Tier 3"),
      ),
    ).toBe(true);
  });

  it("enforces validator and critic write prohibitions and anti-boundary-leak invariants", () => {
    const leakyValidator: DynamicRoleSpec = {
      name: "leaky_validator",
      archetype: "tier_3_validator",
      tier: 3,
      title: "Leaky Validator",
      summary: "Validator attempting write lease",
      grantedCommands: ["validator:findings"],
      permittedActivities: ["Claim lease to edit files"],
      prohibitedActions: [],
      invariants: [],
      spawns: [],
      cognitivePillars: ["Quality"],
      writeScopePolicy: "lease_bounded",
    };
    const res = validateDynamicRoleSpec(leakyValidator);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("must have writeScopePolicy 'forbidden'"))).toBe(true);
    expect(res.errors.some((e) => e.includes("permitted activities contain write actions"))).toBe(
      true,
    );
    expect(res.warnings.some((w) => w.includes("contain Anti-Boundary-Leak prohibition"))).toBe(
      true,
    );
    expect(() => assertValidDynamicRoleSpec(leakyValidator)).toThrow(HarnessError);

    const cleanValidator: DynamicRoleSpec = {
      name: "clean_validator",
      archetype: "tier_3_validator",
      tier: 3,
      title: "Clean Validator",
      summary: "Validator obeying anti-boundary-leak",
      grantedCommands: ["validator:findings"],
      permittedActivities: ["Run read-only verification"],
      prohibitedActions: ["Must follow anti-boundary-leak and never write files"],
      invariants: ["Zero mutation"],
      spawns: [],
      cognitivePillars: ["Verification"],
      writeScopePolicy: "forbidden",
    };
    const cleanRes = validateDynamicRoleSpec(cleanValidator);
    expect(cleanRes.valid).toBe(true);
    expect(cleanRes.warnings).toEqual([]);
  });

  it("enforces forbidden commands across all roles", () => {
    const forbiddenCmdRes = validateDynamicRoleSpec({
      ...validImplementerSpec,
      grantedCommands: ["orchestrator:run"],
    });
    expect(forbiddenCmdRes.valid).toBe(false);
    expect(forbiddenCmdRes.errors.some((e) => e.includes("strictly forbidden"))).toBe(true);
  });

  it("enforces hierarchy spawn constraints and warns on missing cognitive pillars", () => {
    const tier3SpawnRes = validateDynamicRoleSpec({
      ...validImplementerSpec,
      spawns: ["subagent-worker"],
      cognitivePillars: [],
    });
    expect(tier3SpawnRes.valid).toBe(false);
    expect(
      tier3SpawnRes.errors.some((e) => e.includes("Tier 3 roles are leaf execution workers")),
    ).toBe(true);
    expect(tier3SpawnRes.warnings.some((w) => w.includes("no cognitive pillars defined"))).toBe(
      true,
    );

    const tier1InvalidSpawnRes = validateDynamicRoleSpec({
      name: "orchestrator_sub",
      archetype: "tier_1_orchestrator",
      tier: 1,
      title: "Orchestrator",
      summary: "Tier 1 orchestrator",
      grantedCommands: ["doctor"],
      permittedActivities: ["Supervise"],
      prohibitedActions: ["Direct write"],
      invariants: [],
      spawns: ["implementer"],
      cognitivePillars: ["Control"],
      writeScopePolicy: "forbidden",
    });
    expect(
      tier1InvalidSpawnRes.errors.some((e) =>
        e.includes("Tier 1 Orchestrator may only spawn Tier 2 'coordinator'"),
      ),
    ).toBe(true);

    const tier0InvalidSpawnRes = validateDynamicRoleSpec({
      name: "mind_root",
      archetype: "tier_0_mind",
      tier: 0,
      title: "Mind",
      summary: "Tier 0 Mind",
      grantedCommands: ["doctor"],
      permittedActivities: ["Govern"],
      prohibitedActions: ["Write code"],
      invariants: [],
      spawns: ["coordinator"],
      cognitivePillars: ["Consciousness"],
      writeScopePolicy: "forbidden",
    });
    expect(
      tier0InvalidSpawnRes.errors.some((e) =>
        e.includes("Tier 0 Mind may only spawn Tier 1 'orchestrator'"),
      ),
    ).toBe(true);
  });

  it("formats markdown frontmatter, body, and full role document with spawns and metadata", () => {
    const orchestratorSpec: DynamicRoleSpec = {
      name: "orch_role",
      archetype: "tier_1_orchestrator",
      tier: 1,
      title: "Orchestrator Role",
      summary: "Supervises workflows",
      domain: "core",
      grantedCommands: ["doctor"],
      permittedActivities: ["Supervise"],
      prohibitedActions: ["Write code"],
      invariants: ["Maintain cadence"],
      spawns: ["coordinator"],
      cognitivePillars: ["Pillar 1"],
      writeScopePolicy: "forbidden",
    };
    const frontmatter = formatDynamicRoleFrontmatter(orchestratorSpec);
    expect(frontmatter).toContain("role: orch_role");
    expect(frontmatter).toContain("tier: 1");
    expect(frontmatter).toContain("domain: core");
    expect(frontmatter).toContain("- coordinator");

    const emptyArraysSpec: DynamicRoleSpec = {
      ...validImplementerSpec,
      domain: undefined,
      permittedActivities: [],
      prohibitedActions: [],
      grantedCommands: [],
      spawns: [],
      cognitivePillars: [],
      invariants: [],
      version: undefined,
      parentRole: undefined,
    };
    const emptyFrontmatter = formatDynamicRoleFrontmatter(emptyArraysSpec);
    expect(emptyFrontmatter).toContain("may:\n  - []");
    expect(emptyFrontmatter).toContain("must_not:\n  - []");
    expect(emptyFrontmatter).toContain("spawns:\n  - []");
    expect(emptyFrontmatter).not.toContain("domain:");

    const body = formatDynamicRoleBody(validImplementerSpec);
    expect(body).toContain("# Custom Worker Role");
    expect(body).toContain("## Cognitive Pillars");
    expect(body).toContain("- **Authority Tier**: Tier 3");
    expect(body).toContain("- **Generation Version**: v1");
    expect(body).toContain("- **Parent Lineage**: `implementer`");

    const fullMarkdown = formatDynamicRoleMarkdown(validImplementerSpec);
    expect(fullMarkdown.startsWith("---\nrole: custom_worker")).toBe(true);
    expect(fullMarkdown).toContain("# Custom Worker Role");
  });
});
