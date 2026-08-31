import { beforeEach, describe, expect, it } from "bun:test";
import {
  DynamicRoleRegistry,
  getGlobalRoleRegistry,
  renderDynamicRolesAsciiTable,
  resetGlobalRoleRegistry,
  synthesizeDynamicRole,
  type DynamicRoleCatalogExport,
  type DynamicRoleContract,
  type DynamicRoleSpec,
} from "../../../olt/scripts/src/mind/roles/dynamic/index.ts";

describe("Dynamic Tool & Role Registry Unit Test Suite", () => {
  beforeEach(() => {
    resetGlobalRoleRegistry();
  });

  describe("DynamicRoleRegistry instance lifecycle & mutation", () => {
    it("initializes an empty registry with zero count", () => {
      const registry = new DynamicRoleRegistry();
      expect(registry.count()).toBe(0);
      expect(registry.list()).toEqual([]);
      expect(registry.has("test-worker")).toBe(false);
      expect(registry.get("test-worker")).toBeUndefined();
    });

    it("registers dynamic role specs and synthesizes valid contracts", () => {
      const registry = new DynamicRoleRegistry();
      const spec: DynamicRoleSpec = {
        name: "tooling-engineer",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Tooling Engineer",
        summary: "Builds and maintains developer tooling systems.",
        grantedCommands: ["task:claim", "task:submit", "run:exec"],
        permittedActivities: ["Execute build tools", "Submit task completion"],
        prohibitedActions: ["Direct commits to main"],
        invariants: ["Zero any invariant", "Strict test pass"],
        spawns: [],
        cognitivePillars: ["Tooling Reliability", "Deterministic Verification"],
        writeScopePolicy: "lease_bounded",
        domain: "tooling",
      };

      const contract = registry.register(spec);
      expect(contract.role).toBe("tooling-engineer");
      expect(contract.tier).toBe(3);
      expect(contract.domain).toBe("tooling");
      expect(contract.commands).toEqual(["task:claim", "task:submit", "run:exec"]);
      expect(contract.writeScopePolicy).toBe("lease_bounded");
      expect(contract.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(registry.count()).toBe(1);
      expect(registry.has("tooling-engineer")).toBe(true);
      expect(registry.get("tooling-engineer")?.role).toBe("tooling-engineer");
    });

    it("registers existing synthesized contract directly", () => {
      const registry = new DynamicRoleRegistry();
      const contract: DynamicRoleContract = synthesizeDynamicRole({
        name: "test-auditor",
        archetype: "tier_3_validator",
        tier: 3,
        domain: "auditing",
        title: "Test Auditor",
        summary: "Audits test invariants.",
      });

      const registered = registry.register(contract);
      expect(registered).toBe(contract);
      expect(registry.count()).toBe(1);
      expect(registry.get("test-auditor")?.role).toBe("test-auditor");
    });

    it("overwrites existing role upon duplicate registration", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({
        name: "redefined-worker",
        archetype: "tier_3_implementer",
        title: "Initial",
      });
      expect(registry.get("redefined-worker")?.spec.title).toBe("Initial");

      registry.register({
        name: "redefined-worker",
        archetype: "tier_3_implementer",
        title: "Updated",
      });
      expect(registry.count()).toBe(1);
      expect(registry.get("redefined-worker")?.spec.title).toBe("Updated");
    });

    it("revokes existing roles and handles non-existent revocation safely", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({ name: "disposable-worker", archetype: "tier_3_implementer" });
      expect(registry.has("disposable-worker")).toBe(true);

      const revoked = registry.revoke("disposable-worker");
      expect(revoked).toBe(true);
      expect(registry.has("disposable-worker")).toBe(false);
      expect(registry.count()).toBe(0);
      expect(registry.revoke("non-existent-worker")).toBe(false);
    });

    it("clears all registered roles on clear()", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({ name: "worker-1", archetype: "tier_3_implementer" });
      registry.register({ name: "worker-2", archetype: "tier_3_validator" });
      expect(registry.count()).toBe(2);

      registry.clear();
      expect(registry.count()).toBe(0);
      expect(registry.list()).toEqual([]);
      expect(registry.has("worker-1")).toBe(false);
    });
  });

  describe("DynamicRoleRegistry filtering & sorting", () => {
    it("sorts list() alphabetically by role name", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({ name: "zeta-worker", archetype: "tier_3_implementer" });
      registry.register({ name: "alpha-worker", archetype: "tier_3_implementer" });
      registry.register({ name: "beta-worker", archetype: "tier_3_implementer" });

      const names = registry.list().map((r) => r.role);
      expect(names).toEqual(["alpha-worker", "beta-worker", "zeta-worker"]);
    });

    it("filters roles by tier, domain, archetype, and writeScopePolicy", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({ name: "tier0-mind", archetype: "tier_0_mind", domain: "strategy" });
      registry.register({
        name: "tier2-coord",
        archetype: "tier_2_coordinator",
        domain: "planning",
      });
      registry.register({
        name: "tier3-impl-tooling",
        archetype: "tier_3_implementer",
        domain: "tooling",
      });
      registry.register({
        name: "tier3-val-tooling",
        archetype: "tier_3_validator",
        domain: "tooling",
      });

      expect(registry.filterByTier(3)).toHaveLength(2);
      expect(registry.filterByTier(2)).toHaveLength(1);
      expect(registry.filterByTier(0)).toHaveLength(1);
      expect(registry.filterByTier(1)).toHaveLength(0);

      expect(registry.filterByDomain("tooling")).toHaveLength(2);
      expect(registry.filterByDomain("strategy")).toHaveLength(1);
      expect(registry.filterByDomain("nonexistent")).toHaveLength(0);

      expect(registry.filterByArchetype("tier_3_validator")).toHaveLength(1);
      expect(registry.filterByArchetype("tier_3_implementer")).toHaveLength(1);

      const forbidden = registry.list({ writeScopePolicy: "forbidden" });
      expect(forbidden.map((r) => r.role)).toContain("tier3-val-tooling");
      expect(forbidden.map((r) => r.role)).toContain("tier0-mind");
    });
  });

  describe("DynamicRoleRegistry catalog import and export", () => {
    it("exports catalog with ISO timestamp, total count, and role specs", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({
        name: "export-worker-1",
        archetype: "tier_3_implementer",
        domain: "tooling",
      });
      registry.register({
        name: "export-worker-2",
        archetype: "tier_3_validator",
        domain: "tooling",
      });

      const catalog = registry.exportCatalog();
      expect(catalog.totalRoles).toBe(2);
      expect(catalog.roles).toHaveLength(2);
      expect(catalog.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(catalog.roles[0]?.name).toBe("export-worker-1");
      expect(catalog.roles[1]?.name).toBe("export-worker-2");
    });

    it("imports catalog into a new registry instance", () => {
      const catalog: DynamicRoleCatalogExport = {
        exportedAt: new Date().toISOString(),
        totalRoles: 2,
        roles: [
          {
            name: "imported-worker",
            archetype: "tier_3_implementer",
            tier: 3,
            title: "Imported Worker",
            summary: "Imported summary",
            grantedCommands: ["task:claim", "task:submit"],
            permittedActivities: ["Work"],
            prohibitedActions: ["Fail"],
            invariants: ["No any"],
            spawns: [],
            cognitivePillars: ["Integrity"],
            writeScopePolicy: "lease_bounded",
            domain: "tooling",
          },
          {
            name: "imported-validator",
            archetype: "tier_3_validator",
            tier: 3,
            title: "Imported Validator",
            summary: "Validator summary",
            grantedCommands: ["gate:check"],
            permittedActivities: ["Check"],
            prohibitedActions: ["Write"],
            invariants: ["No leak"],
            spawns: [],
            cognitivePillars: ["Adversarial"],
            writeScopePolicy: "forbidden",
            domain: "tooling",
          },
        ],
      };

      const registry = new DynamicRoleRegistry();
      const count = registry.importCatalog(catalog);
      expect(count).toBe(2);
      expect(registry.count()).toBe(2);
      expect(registry.has("imported-worker")).toBe(true);
      expect(registry.has("imported-validator")).toBe(true);
      expect(registry.get("imported-worker")?.commands).toEqual(["task:claim", "task:submit"]);
      expect(registry.get("imported-validator")?.writeScopePolicy).toBe("forbidden");
    });
  });

  describe("DynamicRoleRegistry ASCII table rendering", () => {
    it("renders fallback message when no roles are registered", () => {
      const registry = new DynamicRoleRegistry();
      expect(registry.renderAsciiTable()).toBe("(no dynamic roles registered)");
      expect(renderDynamicRolesAsciiTable([])).toBe("(no dynamic roles registered)");
    });

    it("renders structured ASCII table with aligned columns and borders", () => {
      const registry = new DynamicRoleRegistry();
      registry.register({
        name: "devops-tooling",
        archetype: "tier_3_implementer",
        domain: "infrastructure",
        writeScopePolicy: "lease_bounded",
        grantedCommands: ["run:exec", "shell"],
      });

      const table = registry.renderAsciiTable();
      expect(table).toContain("┌");
      expect(table).toContain("├");
      expect(table).toContain("└");
      expect(table).toContain("Role");
      expect(table).toContain("Tier");
      expect(table).toContain("Archetype");
      expect(table).toContain("Commands");
      expect(table).toContain("Write Policy");
      expect(table).toContain("Domain");
      expect(table).toContain("devops-tooling");
      expect(table).toContain("tier_3_implementer");
      expect(table).toContain("infrastructure");
    });
  });

  describe("Global Role Registry Singleton Management", () => {
    it("returns the same singleton instance across multiple calls", () => {
      const instance1 = getGlobalRoleRegistry();
      const instance2 = getGlobalRoleRegistry();
      expect(instance1).toBe(instance2);

      instance1.register({ name: "singleton-probe", archetype: "tier_3_implementer" });
      expect(instance2.has("singleton-probe")).toBe(true);
    });

    it("clears and reinitializes singleton on resetGlobalRoleRegistry()", () => {
      const initial = getGlobalRoleRegistry();
      initial.register({ name: "ephemeral-role", archetype: "tier_3_implementer" });
      expect(initial.count()).toBe(1);

      resetGlobalRoleRegistry();
      const fresh = getGlobalRoleRegistry();
      expect(fresh).not.toBe(initial);
      expect(fresh.count()).toBe(0);
      expect(fresh.has("ephemeral-role")).toBe(false);
    });
  });
});
