import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  acquireAuditorLeaseLock,
  assertSingletonSkillAuditor,
  DEFAULT_AUDITOR_LEASE_DURATION_MS,
  DEFAULT_AUDITOR_LOCK_FILE,
  defaultIsPidAlive,
  readAuditorLeaseLock,
  releaseAuditorLeaseLock,
} from "../../../olt/scripts/src/authority/guards/singleton-auditor-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualAuthorityFS, getVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Singleton Skill Auditor Lease Guard - Lease Management", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    const vfs = setupVirtualAuthorityFS();
    tempDir = "/virtual/auditor-lease";
    vfs.mkdirSync(tempDir, { recursive: true });
    lockPath = join(tempDir, "skill_auditor.lock");
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  describe("constants and defaults", () => {
    it("exports standard constants and handles PID liveness checks", () => {
      expect(DEFAULT_AUDITOR_LOCK_FILE).toBe(".olt/locks/skill_auditor.lock");
      expect(DEFAULT_AUDITOR_LEASE_DURATION_MS).toBe(300_000);
      expect(defaultIsPidAlive(process.pid)).toBe(true);
      expect(defaultIsPidAlive(-1)).toBe(false);
      expect(defaultIsPidAlive(0)).toBe(false);
      expect(defaultIsPidAlive(1.5)).toBe(false);
      expect(defaultIsPidAlive(99999999)).toBe(false);
    });
  });

  describe("acquireAuditorLeaseLock", () => {
    it("successfully acquires lease lock and persists to disk", () => {
      const lease = acquireAuditorLeaseLock({
        auditor_id: "auditor-01",
        customLockPath: lockPath,
        host_type: "antigravity",
        leaseDurationMs: 60_000,
        pid: 12345,
      });

      expect(lease.auditor_id).toBe("auditor-01");
      expect(lease.pid).toBe(12345);
      expect(lease.host_type).toBe("antigravity");
      expect(typeof lease.acquired_at).toBe("string");
      expect(typeof lease.lease_expires_at).toBe("string");
      expect(typeof lease.lock_token).toBe("string");
      expect(lease.lock_token.length).toBeGreaterThan(0);
      expect(readAuditorLeaseLock(lockPath)).toEqual(lease);
    });

    it("rejects duplicate active auditor with SINGLETON_AUDITOR_COLLISION", () => {
      acquireAuditorLeaseLock({
        auditor_id: "auditor-primary",
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        pid: 11111,
      });

      expect(() => {
        acquireAuditorLeaseLock({
          auditor_id: "auditor-secondary",
          customLockPath: lockPath,
          isPidAliveFn: () => true,
          pid: 22222,
        });
      }).toThrow(HarnessError);

      try {
        acquireAuditorLeaseLock({
          auditor_id: "auditor-secondary",
          customLockPath: lockPath,
          isPidAliveFn: () => true,
          pid: 22222,
        });
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toBe(
          "SINGLETON_AUDITOR_COLLISION: Active skill auditor already running (id=auditor-primary, pid=11111)",
        );
      }
    });

    it("renews lease for same auditor and same PID", () => {
      const original = acquireAuditorLeaseLock({
        auditor_id: "auditor-01",
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        leaseDurationMs: 50_000,
        pid: 12345,
      });

      const renewed = acquireAuditorLeaseLock({
        auditor_id: "auditor-01",
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        leaseDurationMs: 100_000,
        pid: 12345,
      });

      expect(renewed.auditor_id).toBe("auditor-01");
      expect(renewed.pid).toBe(12345);
      expect(renewed.lock_token).toBe(original.lock_token);
      expect(renewed.acquired_at).toBe(original.acquired_at);
      expect(new Date(renewed.lease_expires_at).getTime()).toBeGreaterThanOrEqual(
        new Date(original.lease_expires_at).getTime(),
      );
    });

    it("auto-cleans stale lock when holder PID is dead", () => {
      acquireAuditorLeaseLock({
        auditor_id: "auditor-dead",
        customLockPath: lockPath,
        isPidAliveFn: () => false,
        pid: 99999,
      });

      const newLease = acquireAuditorLeaseLock({
        auditor_id: "auditor-new",
        customLockPath: lockPath,
        isPidAliveFn: (pid) => pid === 22222,
        pid: 22222,
      });

      expect(newLease.auditor_id).toBe("auditor-new");
      expect(newLease.pid).toBe(22222);
    });

    it("auto-cleans expired lease lock", () => {
      const expiredPayload = {
        auditor_id: "auditor-expired",
        pid: 12345,
        host_type: "antigravity",
        acquired_at: new Date(Date.now() - 600_000).toISOString(),
        lease_expires_at: new Date(Date.now() - 300_000).toISOString(),
        lock_token: "expired-token",
      };
      getVirtualAuthorityFS().writeFileSync(lockPath, JSON.stringify(expiredPayload));

      const newLease = acquireAuditorLeaseLock({
        auditor_id: "auditor-fresh",
        customLockPath: lockPath,
        isPidAliveFn: () => true,
        pid: 54321,
      });

      expect(newLease.auditor_id).toBe("auditor-fresh");
      expect(newLease.pid).toBe(54321);
      expect(newLease.lock_token).not.toBe("expired-token");
    });

    it("validates input arguments strictly", () => {
      const invalidNull = null as unknown as { auditor_id: string };
      expect(() => acquireAuditorLeaseLock(invalidNull)).toThrow(HarnessError);
      expect(() => acquireAuditorLeaseLock({ auditor_id: "" })).toThrow(HarnessError);
      expect(() => acquireAuditorLeaseLock({ auditor_id: "a", pid: -10 })).toThrow(HarnessError);
      expect(() => acquireAuditorLeaseLock({ auditor_id: "a", leaseDurationMs: -5 })).toThrow(
        HarnessError,
      );
    });
  });

  describe("releaseAuditorLeaseLock", () => {
    it("releases lock successfully when auditor_id or both id and token match", () => {
      const lease = acquireAuditorLeaseLock({
        auditor_id: "auditor-rel",
        customLockPath: lockPath,
      });
      expect(readAuditorLeaseLock(lockPath)).not.toBeNull();

      expect(
        releaseAuditorLeaseLock({
          auditor_id: "auditor-rel",
          lock_token: lease.lock_token,
          customLockPath: lockPath,
        }),
      ).toBe(true);
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
    });

    it("refuses to release when auditor_id or lock_token do not match", () => {
      const lease = acquireAuditorLeaseLock({
        auditor_id: "auditor-match",
        customLockPath: lockPath,
      });

      expect(
        releaseAuditorLeaseLock({
          auditor_id: "auditor-wrong",
          customLockPath: lockPath,
        }),
      ).toBe(false);

      expect(
        releaseAuditorLeaseLock({
          auditor_id: "auditor-match",
          lock_token: "wrong-token",
          customLockPath: lockPath,
        }),
      ).toBe(false);

      expect(readAuditorLeaseLock(lockPath)?.lock_token).toBe(lease.lock_token);
    });

    it("returns false for non-existent lock or invalid options", () => {
      expect(
        releaseAuditorLeaseLock({
          auditor_id: "none",
          customLockPath: join(tempDir, "nonexistent.lock"),
        }),
      ).toBe(false);

      const invalid = {} as unknown as { auditor_id: string };
      expect(releaseAuditorLeaseLock(invalid)).toBe(false);
    });
  });

  describe("assertSingletonSkillAuditor", () => {
    it("acquires lease with default and custom options and enforces collision", () => {
      const lease = assertSingletonSkillAuditor({
        auditor_id: "skill_auditor",
        customLockPath: lockPath,
      });
      expect(lease.auditor_id).toBe("skill_auditor");

      expect(() => {
        assertSingletonSkillAuditor({
          auditor_id: "another_auditor",
          customLockPath: lockPath,
          isPidAliveFn: () => true,
          pid: process.pid + 1000,
        });
      }).toThrow(HarnessError);
    });
  });
});
