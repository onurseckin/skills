import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  MANDATORY_MIND_COMPANION_AUDITORS,
  createMandatoryMindCompanionGrants,
  bootstrapMindLifecycleWithCompanions,
  verifyMindCompanionBootstrapping,
  assertMindCompanionBootstrapping,
  deployMandatoryMindCompanions,
} from "../../../olt/scripts/src/mind/lifecycle/mind-companions.ts";
import { mindProfile } from "../../../olt/scripts/src/sentinel/profiles/tier0/mind.ts";

describe("Mandatory Inseparable Co-Deployment of Mind and Mind-Auditor Suite", () => {
  const sampleNow = "2026-09-09T12:00:00.000Z";
  const testMindId = "mind-gen-1";

  const activeMindGrant: AgentGrantRecord = {
    id: testMindId,
    role: "mind",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  const activeMindAuditorGrant: AgentGrantRecord = {
    id: `${testMindId}-mind-auditor`,
    role: "mind-auditor",
    parent_agent_id: testMindId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  const activeSkillAuditorGrant: AgentGrantRecord = {
    id: `${testMindId}-skill-auditor`,
    role: "skill-auditor",
    parent_agent_id: testMindId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  describe("createMandatoryMindCompanionGrants", () => {
    it("creates both mandatory companion grants with correct attributes", () => {
      const grants = createMandatoryMindCompanionGrants(testMindId, {
        host: "cluster-node",
        now: sampleNow,
      });

      expect(grants.length).toBe(2);
      const roles = grants.map((g) => g.role);
      expect(roles).toContain("mind-auditor");
      expect(roles).toContain("skill-auditor");

      const mindAuditor = grants.find((g) => g.role === "mind-auditor");
      expect(mindAuditor !== undefined).toBe(true);
      if (mindAuditor !== undefined) {
        expect(mindAuditor.id).toBe(`${testMindId}-mind-auditor`);
        expect(mindAuditor.parent_agent_id).toBe(testMindId);
        expect(mindAuditor.status).toBe("active");
        expect(mindAuditor.host).toBe("cluster-node");
        expect(mindAuditor.granted_at).toBe(sampleNow);
      }
    });

    it("verifies constant MANDATORY_MIND_COMPANION_AUDITORS definitions", () => {
      expect(MANDATORY_MIND_COMPANION_AUDITORS.length).toBe(2);
      expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("mind-auditor");
      expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("skill-auditor");
    });
  });

  describe("bootstrapMindLifecycleWithCompanions", () => {
    it("co-deploys both companions when only Mind grant is present", () => {
      const initial = [activeMindGrant];
      const bootstrapped = bootstrapMindLifecycleWithCompanions(testMindId, initial, {
        host: "local",
        now: sampleNow,
      });

      expect(bootstrapped.length).toBe(3);
      const roles = bootstrapped.map((g) => g.role);
      expect(roles).toContain("mind");
      expect(roles).toContain("mind-auditor");
      expect(roles).toContain("skill-auditor");
    });

    it("deduplicates and reconnects existing mind_auditor with non-canonical role name or inactive status", () => {
      const staleMindAuditor: AgentGrantRecord = {
        id: "stale-mind-auditor-1",
        role: "mind-auditor",
        parent_agent_id: "wrong-parent",
        parent_task_id: null,
        host: "old-host",
        granted_at: sampleNow,
        status: "active",
      };
      const duplicateMindAuditor: AgentGrantRecord = {
        id: "duplicate-mind-auditor-2",
        role: "mind-auditor",
        parent_agent_id: null,
        parent_task_id: null,
        host: "old-host",
        granted_at: sampleNow,
        status: "active",
      };

      const initial = [activeMindGrant, staleMindAuditor, duplicateMindAuditor];
      const bootstrapped = bootstrapMindLifecycleWithCompanions(testMindId, initial, {
        host: "local",
        now: sampleNow,
      });

      // Stale auditor reconnected to testMindId, duplicate dropped, skill-auditor added
      const auditorGrants = bootstrapped.filter((g) => g.role === "mind-auditor");
      expect(auditorGrants.length).toBe(1);
      const firstAuditor = auditorGrants[0];
      expect(firstAuditor.parent_agent_id).toBe(testMindId);
      expect(firstAuditor.status).toBe("active");
    });

    it("preserves unrelated active agents in the ledger", () => {
      const orchestratorGrant: AgentGrantRecord = {
        id: "orchestrator-alpha",
        role: "orchestrator",
        parent_agent_id: testMindId,
        parent_task_id: null,
        host: "local",
        granted_at: sampleNow,
        status: "active",
      };
      const initial = [activeMindGrant, orchestratorGrant];
      const bootstrapped = bootstrapMindLifecycleWithCompanions(testMindId, initial);

      expect(bootstrapped.length).toBe(4);
      const roles = bootstrapped.map((g) => g.role);
      expect(roles).toContain("orchestrator");
      expect(roles).toContain("mind-auditor");
    });
  });

  describe("verifyMindCompanionBootstrapping and assertMindCompanionBootstrapping", () => {
    it("reports incomplete when mind-auditor is absent", () => {
      const verification = verifyMindCompanionBootstrapping([
        activeMindGrant,
        activeSkillAuditorGrant,
      ]);
      expect(verification.complete).toBe(false);
      expect(verification.mindAuditorPresent).toBe(false);
      expect(verification.skillAuditorPresent).toBe(true);
      expect(verification.missing).toContain("mind-auditor");
    });

    it("throws INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION when mind-auditor is missing", () => {
      expect(() => {
        assertMindCompanionBootstrapping([activeMindGrant, activeSkillAuditorGrant], "/any/repo");
      }).toThrow(/INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION/);
    });

    it("throws MANDATORY_COMPANION_AUDITORS_VIOLATION when skill-auditor is missing without repoRoot override", () => {
      expect(() => {
        assertMindCompanionBootstrapping([activeMindGrant, activeMindAuditorGrant]);
      }).toThrow(/MANDATORY_COMPANION_AUDITORS_VIOLATION/);
    });

    it("passes cleanly when both mind-auditor and skill-auditor are active", () => {
      const fullSwarm = [activeMindGrant, activeMindAuditorGrant, activeSkillAuditorGrant];
      const verification = verifyMindCompanionBootstrapping(fullSwarm);
      expect(verification.complete).toBe(true);
      expect(verification.missing.length).toBe(0);
      expect(() => {
        assertMindCompanionBootstrapping(fullSwarm);
      }).not.toThrow();
    });
  });

  describe("deployMandatoryMindCompanions", () => {
    it("returns successful companion deployment result", () => {
      const result = deployMandatoryMindCompanions(testMindId, {
        host: "init-host",
        now: sampleNow,
      });

      expect(result.deployed).toBe(true);
      expect(result.mindAuditorId).toBe(`${testMindId}-mind-auditor`);
      expect(result.skillAuditorId).toBe(`${testMindId}-skill-auditor`);
      expect(result.deployedGrants.length).toBe(2);
      expect(result.timestamp).toBe(sampleNow);
    });
  });

  describe("mindProfile inseparable co-deployment and child role enforcement", () => {
    it("allows mind-auditor and mind_auditor child roles without CROSS_TIER_SPAWNING_VIOLATION", () => {
      const violations1 = mindProfile.evaluate({
        agent_id: testMindId,
        role: "mind",
        child_agent_roles: ["mind-auditor"],
      });
      const crossTier1 = violations1.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier1.length).toBe(0);

      const violations2 = mindProfile.evaluate({
        agent_id: testMindId,
        role: "mind",
        child_agent_roles: ["mind_auditor"],
      });
      const crossTier2 = violations2.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier2.length).toBe(0);
    });

    it("flags INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION when Mind is active without mind-auditor in active_roles", () => {
      const violations = mindProfile.evaluate({
        agent_id: testMindId,
        role: "mind",
        active_roles: ["mind"],
      } as unknown as Parameters<typeof mindProfile.evaluate>[0]);

      const coDeploy = violations.filter(
        (v) => v.code === "INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION",
      );
      expect(coDeploy.length).toBe(1);
      const violation = coDeploy[0];
      expect(violation.severity).toBe("CRITICAL");
    });

    it("flags INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION when active_agents has Mind without mind-auditor", () => {
      const violations = mindProfile.evaluate({
        agent_id: testMindId,
        role: "mind",
        active_agents: [{ id: testMindId, role: "mind", status: "active" }],
      } as unknown as Parameters<typeof mindProfile.evaluate>[0]);

      const coDeploy = violations.filter(
        (v) => v.code === "INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION",
      );
      expect(coDeploy.length).toBe(1);
    });

    it("passes cleanly with zero co-deployment violations when both Mind and Mind-Auditor are active", () => {
      const violations = mindProfile.evaluate({
        agent_id: testMindId,
        role: "mind",
        active_roles: ["mind", "mind-auditor"],
      } as unknown as Parameters<typeof mindProfile.evaluate>[0]);

      const coDeploy = violations.filter(
        (v) => v.code === "INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION",
      );
      expect(coDeploy.length).toBe(0);
    });
  });
});
