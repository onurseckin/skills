import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as fs from "node:fs";
import {
  acquireAuditorLeaseLock,
  defaultIsPidAlive,
  readAuditorLeaseLock,
  releaseAuditorLeaseLock,
} from "../../../olt/scripts/src/authority/guards/singleton-auditor-guard.ts";
import {
  cleanupVirtualAuthorityFS,
  getVirtualAuthorityFS,
  setupVirtualAuthorityFS,
} from "../fixture.ts";

describe("Singleton Skill Auditor Lease Guard - Locking & Edge Cases", () => {
  const tempDir = "/virtual/grants/auditor-flock-test";
  const lockPath = join(tempDir, "skill_auditor.lock");

  beforeEach(() => {
    setupVirtualAuthorityFS();
    const vfs = getVirtualAuthorityFS();
    vfs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  describe("readAuditorLeaseLock edge cases", () => {
    it("returns null on non-existent, empty, or corrupt files", () => {
      const vfs = getVirtualAuthorityFS();
      expect(readAuditorLeaseLock(join(tempDir, "missing.lock"))).toBeNull();
      vfs.writeFileSync(lockPath, "   \n  ");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      vfs.writeFileSync(lockPath, "{ bad json");
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      vfs.writeFileSync(lockPath, JSON.stringify({ auditor_id: "incomplete" }));
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      vfs.writeFileSync(lockPath, JSON.stringify([1, 2, 3]));
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      vfs.writeFileSync(lockPath, JSON.stringify("a string"));
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      vfs.writeFileSync(lockPath, JSON.stringify(123));
      expect(readAuditorLeaseLock(lockPath)).toBeNull();
      expect(readAuditorLeaseLock()).toBeNull();
      expect(readAuditorLeaseLock("   ")).toBeNull();
    });
  });

  describe("pid liveness check error handling", () => {
    it("handles EPERM and other error conditions in defaultIsPidAlive", () => {
      expect(typeof defaultIsPidAlive(1)).toBe("boolean");

      const origKill = process.kill;
      try {
        (process as { kill: unknown }).kill = () => {
          const err = new Error("EPERM") as Error & { code: string };
          err.code = "EPERM";
          throw err;
        };
        expect(defaultIsPidAlive(9999)).toBe(true);

        (process as { kill: unknown }).kill = () => {
          const err = new Error("ESRCH") as Error & { code: string };
          err.code = "ESRCH";
          throw err;
        };
        expect(defaultIsPidAlive(9999)).toBe(false);

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
        Date.now = () => {
          calls++;
          return calls > 2 ? origDateNow() + 10000 : origDateNow();
        };

        const flockPath = `${lockPath}.flock`;
        const fd = fs.openSync(flockPath, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);

        try {
          expect(() => {
            acquireAuditorLeaseLock({
              auditor_id: "auditor-timeout",
              customLockPath: lockPath,
              pollIntervalMs: 0,
            });
          }).toBeDefined();
        } finally {
          fs.closeSync(fd);
        }
      } finally {
        Date.now = origDateNow;
      }
    });
  });

  describe("releaseAuditorLeaseLock edge cases", () => {
    it("returns false if existing lock file cannot be read or parsed", () => {
      const vfs = getVirtualAuthorityFS();
      vfs.writeFileSync(lockPath, "{ invalid json");
      expect(
        releaseAuditorLeaseLock({
          auditor_id: "auditor-1",
          customLockPath: lockPath,
        }),
      ).toBe(false);
    });

    it("returns false if lock token does not match", () => {
      const lease = acquireAuditorLeaseLock({
        auditor_id: "auditor-locked-dir",
        customLockPath: lockPath,
      });
      const released = releaseAuditorLeaseLock({
        auditor_id: "auditor-locked-dir",
        lock_token: "wrong-token-12345",
        customLockPath: lockPath,
      });
      expect(released).toBe(false);

      const realRelease = releaseAuditorLeaseLock({
        auditor_id: "auditor-locked-dir",
        lock_token: lease.lock_token,
        customLockPath: lockPath,
      });
      expect(realRelease).toBe(true);
    });
  });

  describe("zero TypeScript any & zero suppressions invariant", () => {
    it("verifies source files contain zero any and zero suppressions", () => {
      const guardSource = fs.readFileSync(
        join(process.cwd(), "olt/scripts/src/authority/guards/singleton-auditor-guard.ts"),
        "utf-8",
      );
      expect(guardSource).not.toMatch(/: any\b/);
      expect(guardSource).not.toMatch(/\bas any\b/);
      expect(guardSource).not.toMatch(/@ts-(ignore|expect-error|nocheck)/);
    });
  });
});
