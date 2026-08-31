import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("Singleton Skill Auditor Lease Lock Guard", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auditor-guard-test-"));
    lockPath = join(tempDir, "skill_auditor.lock");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
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
      writeFileSync(lockPath, JSON.stringify(expiredPayload), "utf-8");

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

  describe("readAuditorLeaseLock edge cases", () => {
    it("returns null on non-existent, empty, or corrupt files", () => {
      expect(readAuditorLeaseLock(join(tempDir, "missing.lock"))).toBeNull();
      writeFileSync(lockPath, "   \n  ", "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      writeFileSync(lockPath, "{ bad json", "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      writeFileSync(lockPath, JSON.stringify({ auditor_id: "incomplete" }), "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      writeFileSync(lockPath, JSON.stringify([1, 2, 3]), "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      writeFileSync(lockPath, JSON.stringify("a string"), "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      writeFileSync(lockPath, JSON.stringify(123), "utf-8");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      // Test default lock path when no argument provided
      expect(readAuditorLeaseLock()).toBeNull();
      expect(readAuditorLeaseLock("   ")).toBeNull();
    });
  });

  describe("pid liveness check error handling", () => {
    it("handles EPERM and other error conditions in defaultIsPidAlive", () => {
      // Test PID 1 (init/launchd) which often returns true or EPERM
      expect(typeof defaultIsPidAlive(1)).toBe("boolean");

      const origKill = process.kill;
      try {
        // Mock EPERM error object
        (process as { kill: unknown }).kill = () => {
          const err = new Error("EPERM") as Error & { code: string };
          err.code = "EPERM";
          throw err;
        };
        expect(defaultIsPidAlive(9999)).toBe(true);

        // Mock generic error with code ESRCH
        (process as { kill: unknown }).kill = () => {
          const err = new Error("ESRCH") as Error & { code: string };
          err.code = "ESRCH";
          throw err;
        };
        expect(defaultIsPidAlive(9999)).toBe(false);

        // Mock non-object error throw
        (process as { kill: unknown }).kill = () => {
          throw "string error";
        };
        expect(defaultIsPidAlive(9999)).toBe(false);
      } finally {
        process.kill = origKill;
      }
    });
  });

  describe("flock delay and timeout handling", () => {
    it("throws LOCK_TIMEOUT when flock cannot be acquired before timeout", () => {
      const origDateNow = Date.now;
      let calls = 0;
      try {
        // Force Date.now to advance past 5000ms timeout on second check
        Date.now = () => {
          calls++;
          return calls > 2 ? origDateNow() + 10000 : origDateNow();
        };

        const flockPath = `${lockPath}.flock`;
        const { openSync, closeSync, constants } = require("node:fs");
        const { tryExclusiveFlock, releaseFlock } = require("../../../olt/scripts/src/platform/index.ts");
        const fd = openSync(flockPath, constants.O_RDWR | constants.O_CREAT, 0o600);
        tryExclusiveFlock(fd);

        try {
          expect(() => {
            acquireAuditorLeaseLock({
              auditor_id: "auditor-timeout",
              customLockPath: lockPath,
            });
          }).toThrow(HarnessError);
        } finally {
          releaseFlock(fd);
          closeSync(fd);
        }
      } finally {
        Date.now = origDateNow;
      }
    });
  });

  describe("releaseAuditorLeaseLock edge cases", () => {
    it("returns false if existing lock file cannot be read or parsed", () => {
      writeFileSync(lockPath, "{ invalid json", "utf-8");
      expect(
        releaseAuditorLeaseLock({
          auditor_id: "auditor-1",
          customLockPath: lockPath,
        }),
      ).toBe(false);
    });

    it("returns false if removing lock file throws filesystem error", async () => {
      const lease = acquireAuditorLeaseLock({
        auditor_id: "auditor-locked-dir",
        customLockPath: lockPath,
      });
      const { chmodSync } = await import("node:fs");
      try {
        chmodSync(tempDir, 0o500);
        const released = releaseAuditorLeaseLock({
          auditor_id: "auditor-locked-dir",
          lock_token: lease.lock_token,
          customLockPath: lockPath,
        });
        expect(released).toBe(false);
      } finally {
        chmodSync(tempDir, 0o700);
      }
    });
  });

  describe("zero TypeScript any & zero suppressions invariant", () => {
    it("verifies source files contain zero any and zero suppressions", () => {
      const guardSource = readFileSync(
        join(process.cwd(), "olt/scripts/src/authority/guards/singleton-auditor-guard.ts"),
        "utf-8",
      );
      expect(guardSource).not.toMatch(/: any\b/);
      expect(guardSource).not.toMatch(/\bas any\b/);
      expect(guardSource).not.toContain("@ts-ignore");
      expect(guardSource).not.toContain("@ts-expect-error");
      expect(guardSource).not.toContain("@ts-nocheck");
    });
  });
});
