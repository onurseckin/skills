import { describe, expect, test } from "bun:test";
import {
  AUDITOR_ALREADY_ACTIVE_REUSED,
  COMPANION_AUDITOR_ROLES,
  CompanionDeploymentCoordinator,
  checkAuditorPreflight,
  isAuditorHealthy,
  isAuditorStatusReusable,
  isCompanionAuditorRole,
  normalizeAuditorRole,
  preflightCompanionAuditorDeployment,
  validateCompanionAuditorSpawn,
  type ActiveAuditorRecord,
} from "../../../olt/scripts/src/agents/fleet/companion-dedup.ts";

describe("Active Companion Auditor Pre-Flight Check & Deduplication", () => {
  describe("Pillar 1: Pure Functional Preflight & Idempotency", () => {
    test("triggers spawn when active auditor does not exist in fleet", () => {
      const activeFleet: readonly ActiveAuditorRecord[] = [];
      const result = checkAuditorPreflight("skill-auditor", activeFleet);

      expect(result.action).toBe("spawn");
      expect(result.role).toBe("skill-auditor");
      expect(result.existingAuditor).toBeUndefined();
      expect(result.notice).toBeUndefined();
    });

    test("reuses existing active auditor and emits AUDITOR_ALREADY_ACTIVE_REUSED", () => {
      const runningAuditor: ActiveAuditorRecord = {
        id: "mind-auditor-100",
        role: "mind-auditor",
        status: "active",
        parent_agent_id: null,
      };
      const activeFleet = [runningAuditor];

      const result = checkAuditorPreflight("mind-auditor", activeFleet);

      expect(result.action).toBe("reuse");
      expect(result.role).toBe("mind-auditor");
      expect(result.existingAuditor).toBeDefined();
      expect(result.existingAuditor?.id).toBe("mind-auditor-100");
      expect(result.notice).toBeDefined();
      expect(result.notice?.code).toBe(AUDITOR_ALREADY_ACTIVE_REUSED);
      expect(result.notice?.existingAuditorId).toBe("mind-auditor-100");
      expect(result.notice?.message).toContain("AUDITOR_ALREADY_ACTIVE_REUSED");
    });

    test("is strictly pure and side-effect free across multiple evaluations", () => {
      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "sa-1", role: "skill-auditor", status: "running", parent_agent_id: null },
      ];
      const r1 = checkAuditorPreflight("skill-auditor", fleet);
      const r2 = checkAuditorPreflight("skill-auditor", fleet);

      expect(r1.action).toBe("reuse");
      expect(r2.action).toBe("reuse");
      expect(r1.existingAuditor?.id).toBe(r2.existingAuditor?.id);
      expect(fleet.length).toBe(1);
    });
  });

  describe("Pillar 2: Status Whitelisting & Health Invariants", () => {
    test("whitelists only active, running, and idle statuses", () => {
      expect(isAuditorStatusReusable("active")).toBe(true);
      expect(isAuditorStatusReusable("running")).toBe(true);
      expect(isAuditorStatusReusable("idle")).toBe(true);
      expect(isAuditorStatusReusable("ACTIVE")).toBe(true);

      // Transient & terminal states must NOT be reused
      expect(isAuditorStatusReusable("terminating")).toBe(false);
      expect(isAuditorStatusReusable("stopping")).toBe(false);
      expect(isAuditorStatusReusable("draining")).toBe(false);
      expect(isAuditorStatusReusable("pending")).toBe(false);
      expect(isAuditorStatusReusable("restarting")).toBe(false);
      expect(isAuditorStatusReusable("completed")).toBe(false);
      expect(isAuditorStatusReusable("failed")).toBe(false);
      expect(isAuditorStatusReusable("terminated")).toBe(false);
      expect(isAuditorStatusReusable(null)).toBe(false);
      expect(isAuditorStatusReusable(undefined)).toBe(false);
    });

    test("does not reuse terminated, failed, or errored auditors", () => {
      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "sa-dead", role: "skill-auditor", status: "terminated", parent_agent_id: null },
        {
          id: "sa-err",
          role: "skill-auditor",
          status: "active",
          hasError: true,
          parent_agent_id: null,
        },
      ];
      const result = checkAuditorPreflight("skill-auditor", fleet);
      expect(result.action).toBe("spawn");
    });

    test("detects heartbeat staleness and rejects stale instances", () => {
      const now = 1_000_000;
      const freshAuditor: ActiveAuditorRecord = {
        id: "fresh",
        role: "mind-auditor",
        status: "active",
        lastHeartbeatAt: now - 5_000,
      };
      const staleAuditor: ActiveAuditorRecord = {
        id: "stale",
        role: "mind-auditor",
        status: "active",
        lastHeartbeatAt: now - 60_000,
      };

      expect(isAuditorHealthy(freshAuditor, { now, maxStaleHeartbeatMs: 10_000 })).toBe(true);
      expect(isAuditorHealthy(staleAuditor, { now, maxStaleHeartbeatMs: 10_000 })).toBe(false);
    });
  });

  describe("Pillar 3: Normalization & Canonical Multi-Instance Resolution", () => {
    test("normalizes role variations and aliases symmetrically", () => {
      expect(normalizeAuditorRole("mind_auditor")).toBe("mind-auditor");
      expect(normalizeAuditorRole("MIND-AUDITOR")).toBe("mind-auditor");
      expect(normalizeAuditorRole("meta-auditor")).toBe("mind-auditor");
      expect(normalizeAuditorRole("skill_auditor")).toBe("skill-auditor");

      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "ma-alias", role: "mind_auditor", status: "active" },
      ];
      const result = checkAuditorPreflight("MIND-AUDITOR", fleet);
      expect(result.action).toBe("reuse");
      expect(result.existingAuditor?.id).toBe("ma-alias");
    });

    test("deterministically selects newest instance when multiple active exist", () => {
      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "ma-old", role: "mind-auditor", status: "active", startedAt: 100 },
        { id: "ma-newest", role: "mind-auditor", status: "active", startedAt: 500 },
        { id: "ma-mid", role: "mind-auditor", status: "active", startedAt: 300 },
      ];
      const result = checkAuditorPreflight("mind-auditor", fleet);
      expect(result.action).toBe("reuse");
      expect(result.existingAuditor?.id).toBe("ma-newest");
    });
  });

  describe("Pillar 4: Batch Preflight Decomposition", () => {
    test("partitions batch requests into reused and spawn sets", () => {
      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "ma-active", role: "mind-auditor", status: "active" },
      ];
      const batch = preflightCompanionAuditorDeployment(["mind-auditor", "skill-auditor"], fleet);

      expect(batch.hasDuplicatesAverted).toBe(true);
      expect(batch.reused.length).toBe(1);
      expect(batch.reused[0]?.id).toBe("ma-active");
      expect(batch.toSpawn).toEqual(["skill-auditor"]);
      expect(batch.notices.length).toBe(1);
      expect(batch.notices[0]?.code).toBe(AUDITOR_ALREADY_ACTIVE_REUSED);
      expect(batch.allAuditors).toEqual([
        { role: "mind-auditor", auditorId: "ma-active", action: "reuse" },
        { role: "skill-auditor", action: "spawn" },
      ]);
    });
  });

  describe("Pillar 5: Massive Concurrency & Thundering Herd Protection", () => {
    test("handles 25 concurrent callers with exactly 1 underlying spawn", async () => {
      const coordinator = new CompanionDeploymentCoordinator();
      let spawnCount = 0;

      const mockSpawn = async (role: string): Promise<ActiveAuditorRecord> => {
        spawnCount++;
        await new Promise((res) => setTimeout(res, 25));
        return {
          id: `spawned-${role}-${Date.now()}`,
          role,
          status: "active",
          parent_agent_id: "attempted-supervisor", // coordinator will sanitize
        };
      };

      const callers = Array.from({ length: 25 }, () =>
        coordinator.deployCompanion("mind-auditor", mockSpawn),
      );

      const results = await Promise.all(callers);

      expect(spawnCount).toBe(1);
      const spawnResults = results.filter((r) => r.action === "spawn");
      const reuseResults = results.filter((r) => r.action === "reuse");

      expect(spawnResults.length).toBe(1);
      expect(reuseResults.length).toBe(24);

      // Verify all 25 callers received identical instance ID
      const canonicalId = results[0]?.instance.id;
      expect(canonicalId).toBeDefined();
      for (const res of results) {
        expect(res.instance.id).toBe(canonicalId);
        expect(res.instance.parent_agent_id).toBeNull(); // Tier 0 confinement
      }
    });

    test("sequential re-entrancy executes spawn once and reuses subsequently", async () => {
      const coordinator = new CompanionDeploymentCoordinator();
      let spawnCount = 0;

      const mockSpawn = async (role: string): Promise<ActiveAuditorRecord> => {
        spawnCount++;
        return { id: `spawned-${role}`, role, status: "active" };
      };

      const r1 = await coordinator.deployCompanion("skill-auditor", mockSpawn);
      expect(r1.action).toBe("spawn");
      expect(spawnCount).toBe(1);

      for (let i = 0; i < 9; i++) {
        const rSub = await coordinator.deployCompanion("skill-auditor", mockSpawn);
        expect(rSub.action).toBe("reuse");
        expect(rSub.instance.id).toBe("spawned-skill-auditor");
        expect(rSub.notice?.code).toBe(AUDITOR_ALREADY_ACTIVE_REUSED);
      }
      expect(spawnCount).toBe(1);
    });

    test("evicts pending entry cleanly on spawn rejection allowing retry", async () => {
      const coordinator = new CompanionDeploymentCoordinator();
      let callCount = 0;

      const failingSpawn = async (role: string): Promise<ActiveAuditorRecord> => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Transient spawn failure");
        }
        return { id: `retry-${role}`, role, status: "active" };
      };

      await expect(coordinator.deployCompanion("mind-auditor", failingSpawn)).rejects.toThrow(
        "Transient spawn failure",
      );

      // Second call must retry cleanly and succeed
      const retryResult = await coordinator.deployCompanion("mind-auditor", failingSpawn);
      expect(retryResult.action).toBe("spawn");
      expect(retryResult.instance.id).toBe("retry-mind-auditor");
      expect(callCount).toBe(2);
    });
  });

  describe("Pillar 6: Role Confinement & Session Isolation", () => {
    test("rejects non-companion auditor archetypes with violation error", async () => {
      const coordinator = new CompanionDeploymentCoordinator();
      expect(isCompanionAuditorRole("mind-auditor")).toBe(true);
      expect(isCompanionAuditorRole("skill-auditor")).toBe(true);
      expect(isCompanionAuditorRole("independent-planner-auditor")).toBe(true);
      expect(isCompanionAuditorRole("domain-orchestrator")).toBe(false);

      await expect(
        coordinator.deployCompanion("domain-orchestrator", async (r) => ({
          id: "bad",
          role: r,
          status: "active",
        })),
      ).rejects.toThrow("[ROLE_CONFINEMENT_VIOLATION]");
    });

    test("isolates auditors per session when session scope is requested", async () => {
      const coordinator = new CompanionDeploymentCoordinator();
      let spawnCount = 0;
      const mockSpawn = async (role: string): Promise<ActiveAuditorRecord> => {
        spawnCount++;
        return {
          id: `auditor-${spawnCount}`,
          role,
          status: "active",
          sessionId: spawnCount === 1 ? "session-A" : "session-B",
        };
      };

      const resA = await coordinator.deployCompanion("skill-auditor", mockSpawn, {
        scope: "session",
        sessionId: "session-A",
      });
      expect(resA.action).toBe("spawn");
      expect(resA.instance.id).toBe("auditor-1");

      // Calling again in session-A reuses auditor-1
      const resA2 = await coordinator.deployCompanion("skill-auditor", mockSpawn, {
        scope: "session",
        sessionId: "session-A",
      });
      expect(resA2.action).toBe("reuse");
      expect(resA2.instance.id).toBe("auditor-1");

      // Calling in session-B triggers a fresh spawn for session-B
      const resB = await coordinator.deployCompanion("skill-auditor", mockSpawn, {
        scope: "session",
        sessionId: "session-B",
      });
      expect(resB.action).toBe("spawn");
      expect(resB.instance.id).toBe("auditor-2");
      expect(spawnCount).toBe(2);
    });

    test("integrates with fleet spawn validation to block duplicate subagent spawn", () => {
      const fleet: readonly ActiveAuditorRecord[] = [
        { id: "sa-live", role: "skill-auditor", status: "active" },
      ];

      const blocked = validateCompanionAuditorSpawn("orchestrator", "skill-auditor", fleet);
      expect(blocked.allowed).toBe(false);
      expect(blocked.action).toBe("reuse");
      expect(blocked.existingAuditor?.id).toBe("sa-live");
      expect(blocked.notice?.code).toBe(AUDITOR_ALREADY_ACTIVE_REUSED);

      const allowed = validateCompanionAuditorSpawn("orchestrator", "mind-auditor", fleet);
      expect(allowed.allowed).toBe(true);
      expect(allowed.action).toBe("spawn");

      const rejected = validateCompanionAuditorSpawn("orchestrator", "foreign-agent", fleet);
      expect(rejected.allowed).toBe(false);
      expect(rejected.action).toBe("rejected");
    });
  });
});
