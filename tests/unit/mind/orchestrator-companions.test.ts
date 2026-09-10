import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  MANDATORY_ORCHESTRATOR_COMPANION_ROLE,
  assertOrchestratorCompanionPairing,
  ensureOrchestratorCompanionAuditor,
  isSkillAuditorEntity,
  verifyOrchestratorCompanionPairing,
} from "../../../olt/scripts/src/mind/lifecycle/orchestrator-companions.ts";
import { orchestratorProfile } from "../../../olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts";

describe("Orchestrator Companion Skill-Auditor Pairing & Anti-Duplication Suite", () => {
  const sampleNow = "2026-09-09T12:00:00.000Z";
  const testOrchId = "orch-alpha";

  const activeCoordinatorGrant: AgentGrantRecord = {
    id: `${testOrchId}-coordinator`,
    role: "coordinator",
    parent_agent_id: testOrchId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  const activeSkillAuditorGrant: AgentGrantRecord = {
    id: `${testOrchId}-skill-auditor`,
    role: "skill-auditor",
    parent_agent_id: testOrchId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  const duplicateSkillAuditorGrant: AgentGrantRecord = {
    id: `${testOrchId}-skill-auditor-extra`,
    role: "skill-auditor",
    parent_agent_id: testOrchId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "active",
  };

  const inactiveSkillAuditorGrant: AgentGrantRecord = {
    id: `${testOrchId}-skill-auditor-stopped`,
    role: "skill-auditor",
    parent_agent_id: testOrchId,
    parent_task_id: null,
    host: "local",
    granted_at: sampleNow,
    status: "revoked",
  };

  describe("isSkillAuditorEntity role and id resolution", () => {
    it("recognizes standard and canonical skill-auditor roles", () => {
      expect(isSkillAuditorEntity("skill-auditor")).toBe(true);
      expect(isSkillAuditorEntity("skill_auditor")).toBe(true);
      expect(isSkillAuditorEntity("meta-auditor")).toBe(true);
      expect(isSkillAuditorEntity("orchestrator-skill-auditor")).toBe(true);
      expect(isSkillAuditorEntity("orch_skill_auditor")).toBe(true);
    });

    it("rejects non-auditor roles and undefined inputs", () => {
      expect(isSkillAuditorEntity(undefined)).toBe(false);
      expect(isSkillAuditorEntity("coordinator")).toBe(false);
      expect(isSkillAuditorEntity("implementer")).toBe(false);
      expect(isSkillAuditorEntity("mind")).toBe(false);
    });
  });

  describe("ensureOrchestratorCompanionAuditor idempotent deployment and wake", () => {
    it("deploys exactly one companion skill-auditor when absent", () => {
      let deployedGrantId = "";
      const result = ensureOrchestratorCompanionAuditor({
        orchestratorId: testOrchId,
        now: sampleNow,
        activeGrants: [activeCoordinatorGrant],
        isPidAliveFn: () => false,
        deployFn: (grant) => {
          deployedGrantId = grant.id;
        },
      });

      expect(result.paired).toBe(true);
      expect(result.action).toBe("deployed");
      expect(result.auditorId).toBe(`${testOrchId}-skill-auditor`);
      expect(result.role).toBe("skill-auditor");
      expect(result.grant.parent_agent_id).toBe(testOrchId);
      expect(result.grant.status).toBe("active");
      expect(result.deduplicatedCount).toBe(0);
      expect(deployedGrantId).toBe(`${testOrchId}-skill-auditor`);
    });

    it("idempotently reconnects when auditor grant is already active", () => {
      const result = ensureOrchestratorCompanionAuditor({
        orchestratorId: testOrchId,
        now: sampleNow,
        activeGrants: [activeCoordinatorGrant, activeSkillAuditorGrant],
      });

      expect(result.paired).toBe(true);
      expect(result.action).toBe("reconnected");
      expect(result.auditorId).toBe(`${testOrchId}-skill-auditor`);
      expect(result.reconnected).toBe(true);
      expect(result.deduplicatedCount).toBe(0);
    });

    it("wakes inactive auditor when stopped grant is detected", () => {
      let wokenId = "";
      const result = ensureOrchestratorCompanionAuditor({
        orchestratorId: testOrchId,
        now: sampleNow,
        activeGrants: [inactiveSkillAuditorGrant],
        wakeFn: (id) => {
          wokenId = id;
        },
      });

      expect(result.paired).toBe(true);
      expect(result.action).toBe("woken");
      expect(result.auditorId).toBe(`${testOrchId}-skill-auditor-stopped`);
      expect(wokenId).toBe(`${testOrchId}-skill-auditor-stopped`);
    });

    it("deduplicates multiple active auditors and preserves exactly one primary", () => {
      const revokedIds: string[] = [];
      const result = ensureOrchestratorCompanionAuditor({
        orchestratorId: testOrchId,
        now: sampleNow,
        activeGrants: [activeSkillAuditorGrant, duplicateSkillAuditorGrant],
        deduplicateFn: (id) => {
          revokedIds.push(id);
        },
      });

      expect(result.paired).toBe(true);
      expect(result.action).toBe("reconnected");
      expect(result.auditorId).toBe(`${testOrchId}-skill-auditor`);
      expect(result.deduplicatedCount).toBe(1);
      expect(revokedIds.length).toBe(1);
      const revokedFirst = revokedIds[0];
      if (revokedFirst !== undefined) {
        expect(revokedFirst).toBe(`${testOrchId}-skill-auditor-extra`);
      }
    });

    it("reconnects to running subagent when subagents list is provided", () => {
      const liveSubagents = [
        {
          subagent_id: "orch-live-auditor",
          role: "skill-auditor",
          pid: 12345,
          status: "active",
        },
      ];
      const result = ensureOrchestratorCompanionAuditor({
        orchestratorId: testOrchId,
        now: sampleNow,
        subagents: liveSubagents,
        isPidAliveFn: (pid) => pid === 12345,
      });

      expect(result.paired).toBe(true);
      expect(result.action).toBe("reconnected");
      expect(result.auditorId).toBe("orch-live-auditor");
    });

    it("supports string orchestratorId invocation overload", () => {
      const result = ensureOrchestratorCompanionAuditor("orch-overload", {
        now: sampleNow,
        activeGrants: [activeCoordinatorGrant],
        isPidAliveFn: () => false,
      });

      expect(result.paired).toBe(true);
      expect(result.auditorId).toBe("orch-overload-skill-auditor");
      expect(result.grant.parent_agent_id).toBe("orch-overload");
    });
  });

  describe("verifyOrchestratorCompanionPairing and assertOrchestratorCompanionPairing", () => {
    it("verifies clean pairing when exactly one active skill-auditor is present", () => {
      const verification = verifyOrchestratorCompanionPairing([
        activeCoordinatorGrant,
        activeSkillAuditorGrant,
      ]);

      expect(verification.paired).toBe(true);
      expect(verification.auditorCount).toBe(1);
      expect(verification.issues.length).toBe(0);
      expect(MANDATORY_ORCHESTRATOR_COMPANION_ROLE).toBe("skill-auditor");
    });

    it("detects missing auditor and reports pairing violation", () => {
      const verification = verifyOrchestratorCompanionPairing([activeCoordinatorGrant]);

      expect(verification.paired).toBe(false);
      expect(verification.auditorCount).toBe(0);
      expect(verification.issues.length).toBe(1);
    });

    it("detects duplicate auditors and reports conflict", () => {
      const verification = verifyOrchestratorCompanionPairing([
        activeSkillAuditorGrant,
        duplicateSkillAuditorGrant,
      ]);

      expect(verification.paired).toBe(false);
      expect(verification.auditorCount).toBe(2);
      expect(verification.issues.length).toBe(1);
    });

    it("throws ORCHESTRATOR_COMPANION_PAIRING_VIOLATION when mandatory auditor is absent", () => {
      let caughtError: HarnessError | null = null;
      try {
        assertOrchestratorCompanionPairing([activeCoordinatorGrant]);
      } catch (err) {
        if (err instanceof HarnessError) {
          caughtError = err;
        }
      }

      expect(caughtError !== null).toBe(true);
      if (caughtError !== null) {
        expect(caughtError.code).toBe("INVALID_STATE");
        expect(caughtError.message.includes("ORCHESTRATOR_COMPANION_PAIRING_VIOLATION")).toBe(true);
      }
    });

    it("throws DUPLICATE_SKILL_AUDITOR_VIOLATION when duplicate auditors are present", () => {
      let caughtError: HarnessError | null = null;
      try {
        assertOrchestratorCompanionPairing([activeSkillAuditorGrant, duplicateSkillAuditorGrant]);
      } catch (err) {
        if (err instanceof HarnessError) {
          caughtError = err;
        }
      }

      expect(caughtError !== null).toBe(true);
      if (caughtError !== null) {
        expect(caughtError.code).toBe("INVALID_STATE");
        expect(caughtError.message.includes("DUPLICATE_SKILL_AUDITOR_VIOLATION")).toBe(true);
      }
    });

    it("supports AssertOrchestratorCompanionOptions object signature", () => {
      const verification = verifyOrchestratorCompanionPairing({
        orchestratorId: testOrchId,
        activeGrants: [activeSkillAuditorGrant],
      });

      expect(verification.paired).toBe(true);
      expect(verification.auditorCount).toBe(1);
      expect(() => {
        assertOrchestratorCompanionPairing({
          orchestratorId: testOrchId,
          activeGrants: [activeSkillAuditorGrant],
        });
      }).not.toThrow();
    });
  });

  describe("orchestratorProfile sentinel compliance", () => {
    it("allows companion skill-auditor without CROSS_TIER_SPAWNING_VIOLATION", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["skill-auditor"],
      });

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    it("allows companion skill_auditor role variant without violation", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["skill_auditor"],
      });

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    it("allows coordinator child role alongside companion skill-auditor", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["coordinator", "skill-auditor"],
      });

      expect(violations.length).toBe(0);
    });

    it("emits DUPLICATE_SKILL_AUDITOR_VIOLATION when multiple auditors are present", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["skill-auditor", "skill-auditor"],
      });

      const dupViolation = violations.find((v) => v.code === "DUPLICATE_SKILL_AUDITOR_VIOLATION");
      expect(dupViolation !== undefined).toBe(true);
      if (dupViolation !== undefined) {
        expect(dupViolation.severity).toBe("CRITICAL");
        expect(dupViolation.message.includes("duplicate skill-auditors")).toBe(true);
      }

      const crossTier = violations.filter((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier.length).toBe(0);
    });

    it("emits DUPLICATE_SKILL_AUDITOR_VIOLATION for mixed variant duplicates", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["skill-auditor", "skill_auditor"],
      });

      expect(violations.some((v) => v.code === "DUPLICATE_SKILL_AUDITOR_VIOLATION")).toBe(true);
    });

    it("prohibits Tier 3 worker spawns with CROSS_TIER_SPAWNING_VIOLATION", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["implementer"],
      });

      const crossTier = violations.find((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
      expect(crossTier !== undefined).toBe(true);
      if (crossTier !== undefined) {
        expect(crossTier.severity).toBe("CRITICAL");
      }
    });

    it("detects both DUPLICATE_SKILL_AUDITOR_VIOLATION and CROSS_TIER_SPAWNING_VIOLATION concurrently", () => {
      const violations = orchestratorProfile.evaluate({
        agent_id: testOrchId,
        role: "orchestrator",
        child_agent_roles: ["skill-auditor", "skill_auditor", "validator"],
      });

      expect(violations.some((v) => v.code === "DUPLICATE_SKILL_AUDITOR_VIOLATION")).toBe(true);
      expect(violations.some((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
    });
  });
});
