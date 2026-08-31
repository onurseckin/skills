import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  const tmpDir = join(
    process.cwd(),
    ".tmp",
    `spawn-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );

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

  it("allows skill_auditor spawn when previous lease is expired", () => {
    const expiredLease = createActiveLease({
      lease_expires_at: new Date(Date.now() - 30_000).toISOString(),
    });
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => expiredLease,
      isPidAliveFn: () => true,
    });

    expect(result.allowed).toBe(true);
    expect(result.role).toBe("skill_auditor");
    expect(result.active_lease).toBeNull();
    expect(() =>
      rejectDuplicateAuditorSpawn(request, {
        activeLeaseReader: () => expiredLease,
        isPidAliveFn: () => true,
      }),
    ).not.toThrow();
  });

  it("rejects duplicate skill_auditor spawn when active lease exists", () => {
    const activeLease = createActiveLease();
    const request: SubagentSpawnRequest = {
      role: "skill_auditor",
      subagent_id: "duplicate-auditor",
    };

    const result = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
    });

    expect(result.allowed).toBe(false);
    expect(result.role).toBe("skill_auditor");
    expect(result.reason).toBe(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
    expect(result.active_lease).toEqual(activeLease);

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
      expect(harnessErr.message).toBe(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
    }
  });

  it("handles case-insensitive and trimmed skill_auditor role variants", () => {
    const activeLease = createActiveLease();
    const variants = ["SKILL_AUDITOR", "  skill_auditor  ", "Skill_Auditor"];

    for (const role of variants) {
      const request: SubagentSpawnRequest = { role };
      const result = validateSubagentSpawnRequest(request, {
        activeLeaseReader: () => activeLease,
        isPidAliveFn: () => true,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe(DUPLICATE_SINGLETON_AUDITOR_MESSAGE);
      expect(() =>
        rejectDuplicateAuditorSpawn(request, {
          activeLeaseReader: () => activeLease,
          isPidAliveFn: () => true,
        }),
      ).toThrow(HarnessError);
    }
  });

  it("handles invalid or malformed requests gracefully", () => {
    const invalidRequest = { role: 123 } as unknown as SubagentSpawnRequest;
    const result = validateSubagentSpawnRequest(invalidRequest);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INVALID_ARGUMENT");
    expect(() => rejectDuplicateAuditorSpawn(invalidRequest)).toThrow(HarnessError);
  });

  it("reads lock from filesystem via readAuditorLeaseLock", () => {
    mkdirSync(tmpDir, { recursive: true });
    const lockFile = join(tmpDir, "skill_auditor.lock");

    expect(readAuditorLeaseLock(lockFile)).toBeNull();

    const validPayload: AuditorLeaseLock = {
      auditor_id: "fs-auditor-1",
      pid: process.pid,
      host_type: "antigravity",
      acquired_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
      lock_token: "token-xyz",
    };
    writeFileSync(lockFile, JSON.stringify(validPayload), "utf-8");

    const parsed = readAuditorLeaseLock(lockFile);
    expect(parsed).toEqual(validPayload);

    // Test with validateSubagentSpawnRequest using customLockPath
    const request: SubagentSpawnRequest = { role: DEFAULT_SINGLETON_AUDITOR_ROLE };
    const valResult = validateSubagentSpawnRequest(request, {
      customLockPath: lockFile,
      isPidAliveFn: () => true,
    });
    expect(valResult.allowed).toBe(false);
    expect(valResult.active_lease).toEqual(validPayload);

    // Corrupted file
    writeFileSync(lockFile, "{ invalid json", "utf-8");
    expect(readAuditorLeaseLock(lockFile)).toBeNull();

    // Incomplete payload
    writeFileSync(lockFile, JSON.stringify({ pid: 123 }), "utf-8");
    expect(readAuditorLeaseLock(lockFile)).toBeNull();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("checks defaultIsPidAlive with various PID inputs", () => {
    expect(defaultIsPidAlive(process.pid)).toBe(true);
    expect(defaultIsPidAlive(-1)).toBe(false);
    expect(defaultIsPidAlive(0)).toBe(false);
    expect(defaultIsPidAlive(1.5)).toBe(false);
  });

  it("handles various now option types in validateSubagentSpawnRequest", () => {
    const activeLease = createActiveLease({
      lease_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const request: SubagentSpawnRequest = { role: "skill_auditor" };

    // now as Date
    const resDate = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
      now: new Date(Date.now() - 60_000),
    });
    expect(resDate.allowed).toBe(false);

    // now as ISO string
    const resString = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
      now: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(resString.allowed).toBe(false);

    // now as invalid string (falls back to Date.now())
    const resInvalid = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
      now: "invalid-date-string",
    });
    expect(resInvalid.allowed).toBe(false);

    // now as NaN number (falls back to Date.now())
    const resNan = validateSubagentSpawnRequest(request, {
      activeLeaseReader: () => activeLease,
      isPidAliveFn: () => true,
      now: NaN,
    });
    expect(resNan.allowed).toBe(false);

    // null or undefined request
    const resNull = validateSubagentSpawnRequest(null as unknown as SubagentSpawnRequest);
    expect(resNull.allowed).toBe(false);
    expect(resNull.role).toBe("unknown");
  });
});
