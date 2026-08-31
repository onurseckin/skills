import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireAuditorLeaseLock,
  defaultIsPidAlive,
  readAuditorLeaseLock,
  releaseAuditorLeaseLock,
} from "../../../olt/scripts/src/authority/guards/singleton-auditor-guard.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { tryExclusiveFlock, releaseFlock } from "../../../olt/scripts/src/platform/index.ts";

describe("Singleton Skill Auditor Lease Guard - Locking & Edge Cases", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "auditor-flock-test-"));
    lockPath = join(tempDir, "skill_auditor.lock");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
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
        const { openSync, closeSync, constants } = require("node:fs");
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
      expect(guardSource).not.toMatch(/@ts-(ignore|expect-error|nocheck)/);
    });
  });
});
