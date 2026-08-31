import { describe, expect, it } from "bun:test";
import {
  type AuditorLeaseLock,
  DEFAULT_SINGLETON_AUDITOR_ROLE,
  DUPLICATE_SINGLETON_AUDITOR_MESSAGE,
  defaultIsPidAlive,
  readAuditorLeaseLock,
  rejectDuplicateAuditorSpawn,
  type SubagentSpawnRequest,
  validateSubagentSpawnRequest,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Subagent Spawn Request Cardinality Validator", () => {
  const createActiveLease = (overrides?: Partial<AuditorLeaseLock>): AuditorLeaseLock => ({
    auditor_id: "auditor-uuid-1",
    pid: process.pid,
    host_type: "antigravity",
    acquired_at: new Date().toISOString(),
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    lock_token: "token-abc-123",
    ...overrides,
  });

  it("allows non-auditor subagent spawns (implementer, validator, orchestrator, worker)", () => {
    const roles = ["implementer", "validator", "orchestrator", "worker", "coordinator", "mind"];

    for (const role of roles) {
      const request: SubagentSpawnRequest = {
        role,
        name: `agent-${role}`,
        subagent_id: `sub-${role}-1`,
        conversation_id: "conv-100",
        target_tier: 2,
        requested_by: "parent-orchestrator",
      };

      const result = validateSubagentSpawnRequest(request, {
        activeLeaseReader: () => createActiveLease(),
        isPidAliveFn: () => true,
      });

      expect(result.allowed).toBe(true);
      expect(result.role).toBe(role);
      expect(result.active_lease).toBeNull();
      expect(() => rejectDuplicateAuditorSpawn(request)).not.toThrow();
    }
  });

  it("allows skill_auditor spawn when no active lease exists", () => {
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
      subagent_id: "auditor-spawn-1",
      conversation_id: "conv-200",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => null,
      isPidAliveFn: () => false,
    });

    expect(result.allowed).toBe(true);
    expect(result.role).toBe("skill_auditor");
    expect(result.active_lease).toBeNull();
    expect(() =>
      rejectDuplicateAuditorSpawn(request, {
        activeLeaseReader: () => null,
      }),
    ).not.toThrow();
  });

  it("allows skill_auditor spawn when previous lease holding PID is dead", () => {
    const staleLease = createActiveLease({ pid: 999999 });
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
      subagent_id: "auditor-spawn-2",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => staleLease,
      isPidAliveFn: () => false,
    });

    expect(result.allowed).toBe(true);
    expect(result.role).toBe("skill_auditor");
    expect(result.active_lease).toBeNull();
    expect(() =>
      rejectDuplicateAuditorSpawn(request, {
        activeLeaseReader: () => staleLease,
        isPidAliveFn: () => false,
      }),
    ).not.toThrow();
  });

  it("allows skill_auditor spawn when previous lease has expired", () => {
    const expiredLease = createActiveLease({
      pid: process.pid,
      lease_expires_at: new Date(Date.now() - 5_000).toISOString(),
    });
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
      subagent_id: "auditor-spawn-3",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => expiredLease,
      isPidAliveFn: () => true,
    });

    expect(result.allowed).toBe(true);
    expect(result.role).toBe("skill_auditor");
    expect(result.active_lease).toBeNull();
  });

  it("blocks skill_auditor spawn when active valid lease exists on live PID", () => {
    const activeLease = createActiveLease({
      auditor_id: "active-auditor-primary",
      pid: 12345,
      lease_expires_at: new Date(Date.now() + 100_000).toISOString(),
    });
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
      name: "duplicate_auditor",
      subagent_id: "auditor-spawn-dup",
      requested_by: "test-runner",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
    });

    expect(result.allowed).toBe(false);
    expect(result.role).toBe("skill_auditor");
    expect(result.active_lease).toEqual(activeLease);
    expect(result.reason).toContain(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
    expect(result.reason).toContain("active-auditor-primary");
    expect(result.reason).toContain("12345");

    expect(() =>
      rejectDuplicateAuditorSpawn(request, {
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
      }),
    ).toThrow(HarnessError);

    try {
      rejectDuplicateAuditorSpawn(request, {
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
      });
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(harnessErr.message).toContain(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
      expect(harnessErr.message).toContain("active-auditor-primary");
    }
  });

  it("blocks variant names matching singleton auditor pattern (e.g. meta-auditor, cognitive-auditor)", () => {
    const auditorVariants = [
      "skill-auditor",
      "skill_auditor",
      "skill-auditor-1",
      "cognitive-auditor",
      "cognitive_auditor",
      "meta-auditor",
      "meta_auditor",
      "auditor",
      "singleton-auditor",
      "singleton_auditor",
    ];

    const activeLease = createActiveLease({
      auditor_id: "active-singleton-auditor",
      pid: 54321,
    });

    for (const role of auditorVariants) {
      const request: SubagentSpawnRequest = {
        role,
        name: `agent-${role}`,
      };

      const result = validateSubagentSpawnRequest(request, {
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
      });

      expect(result.allowed).toBe(false);
      expect(result.role).toBe(role);
      expect(() =>
        rejectDuplicateAuditorSpawn(request, {
          activeLeaseReader: () => activeLease,
          isPidAliveFn: () => true,
        }),
      ).toThrow(HarnessError);
    }
  });

  it("handles whitespace, case insensitivity, and trimming in role identification", () => {
    const activeLease = createActiveLease({ auditor_id: "main-auditor", pid: 7777 });

    const requests: SubagentSpawnRequest[] = [
      { role: "  skill_auditor  " },
      { role: "SKILL_AUDITOR" },
      { role: "Skill_Auditor" },
      { role: "  COGNITIVE-AUDITOR  " },
    ];

    for (const req of requests) {
      const result = validateSubagentSpawnRequest(req, {
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
      });
      expect(result.allowed).toBe(false);
    }
  });

  it("rejects invalid request payloads with HarnessError", () => {
    const invalidPayloads = [
      null as unknown as SubagentSpawnRequest,
      {} as unknown as SubagentSpawnRequest,
      { role: "" } as SubagentSpawnRequest,
      { role: "   " } as SubagentSpawnRequest,
      { role: 123 } as unknown as SubagentSpawnRequest,
    ];

    for (const invalid of invalidPayloads) {
      const res = validateSubagentSpawnRequest(invalid);
      expect(res.allowed).toBe(false);
      expect(() => rejectDuplicateAuditorSpawn(invalid)).toThrow(HarnessError);
    }
  });

  it("exports standard role constants and checks defaultIsPidAlive", () => {
    expect(DEFAULT_SINGLETON_AUDITOR_ROLE).toBe("skill_auditor");
    expect(defaultIsPidAlive(process.pid)).toBe(true);
    expect(defaultIsPidAlive(-1)).toBe(false);
  });
});
