import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  cleanseDanglingLocks,
  isProcessAlive,
  recoverStaleLeases,
} from "../../../olt/scripts/src/reporting/doctor/lock-cleaner.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";

describe("lock-cleaner coverage", () => {
  describe("isProcessAlive", () => {
    it("returns false for invalid, non-integer, or non-positive PIDs", () => {
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(12.34)).toBe(false);
      expect(isProcessAlive(Number.NaN)).toBe(false);
      expect(isProcessAlive(Number.POSITIVE_INFINITY)).toBe(false);
    });

    it("returns true for the current running process PID", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it("returns false for non-existent dead PID", () => {
      expect(isProcessAlive(99999999)).toBe(false);
    });
  });

  describe("cleanseDanglingLocks", () => {
    it("handles missing target directories and default directories gracefully", () => {
      const tempRoot = join(tmpdir(), `test-lock-cleaner-empty-${Date.now()}`);
      mkdirSync(tempRoot, { recursive: true });
      try {
        const cleared = cleanseDanglingLocks({ repoRoot: tempRoot });
        expect(cleared).toEqual([]);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    it("cleans zero-byte stagnant locks older than grace period, keeps fresh zero-byte locks", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-zerobyte-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const oldZero = join(tempDir, "old-zero.lock");
        const freshZero = join(tempDir, "fresh-zero.lock");
        writeFileSync(oldZero, "");
        writeFileSync(freshZero, "");

        const nowSec = Date.now() / 1000;
        utimesSync(oldZero, nowSec - 50, nowSec - 50);
        utimesSync(freshZero, nowSec - 2, nowSec - 2);

        const cleared = cleanseDanglingLocks({ lockDirs: [tempDir] });
        expect(cleared.some((c) => c.includes("old-zero.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("fresh-zero.lock"))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("cleans stale locks exceeding staleSeconds limit and ignores non-lock files/directories", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-stale-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const staleLock = join(tempDir, "stale.lock");
        const regularFile = join(tempDir, "regular.txt");
        const subDirLock = join(tempDir, "subdir.lock");
        mkdirSync(subDirLock, { recursive: true });
        writeFileSync(staleLock, "dummy content");
        writeFileSync(regularFile, "dummy content");

        const pastSec = Date.now() / 1000 - 500;
        utimesSync(staleLock, pastSec, pastSec);

        const cleared = cleanseDanglingLocks({ lockDirs: [tempDir], staleSeconds: 100 });
        expect(cleared.some((c) => c.includes("stale.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("regular.txt"))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("cleans JSON locks with expired timestamp or dead PID, and keeps valid JSON locks", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-json-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const expiredLock = join(tempDir, "expired.lock");
        const deadPidLock = join(tempDir, "dead-pid.lock");
        const alivePidLock = join(tempDir, "alive-pid.lock");

        writeFileSync(expiredLock, JSON.stringify({ expiresAt: Date.now() - 10000 }));
        writeFileSync(deadPidLock, JSON.stringify({ pid: 99999999 }));
        writeFileSync(
          alivePidLock,
          JSON.stringify({ pid: process.pid, expiresAt: Date.now() + 60000 }),
        );

        const cleared = cleanseDanglingLocks({ lockDirs: [tempDir] });
        expect(cleared.some((c) => c.includes("expired.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("dead-pid.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("alive-pid.lock"))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("cleans plain text PID locks with dead PIDs and unparseable corrupt locks older than 30s", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-text-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const deadPidTxt = join(tempDir, "dead-pid.lock");
        const alivePidTxt = join(tempDir, "lock");
        const corruptOld = join(tempDir, "corrupt-old.lock");
        const corruptFresh = join(tempDir, "corrupt-fresh.lock");

        writeFileSync(deadPidTxt, "99999999");
        writeFileSync(alivePidTxt, `${process.pid}`);
        writeFileSync(corruptOld, "{ invalid: json: syntax }");
        writeFileSync(corruptFresh, "{ invalid: json: syntax }");

        const pastSec = Date.now() / 1000 - 60;
        utimesSync(corruptOld, pastSec, pastSec);

        const cleared = cleanseDanglingLocks({ lockDirs: [tempDir] });
        expect(cleared.some((c) => c.includes("dead-pid.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("lock") && c.includes(`${process.pid}`))).toBe(false);
        expect(cleared.some((c) => c.includes("corrupt-old.lock"))).toBe(true);
        expect(cleared.some((c) => c.includes("corrupt-fresh.lock"))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("recoverStaleLeases", () => {
    it("returns empty array when given non-existent runRoot or runs without stale leases", () => {
      const recovered = recoverStaleLeases("/nonexistent/run/root/12345");
      expect(recovered).toEqual([]);
    });

    it("safely handles custom actor and graceSeconds options", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-run-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const recovered = recoverStaleLeases(tempDir, {
          actor: "custom-doctor",
          graceSeconds: 15,
        });
        expect(recovered).toEqual([]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("recovers stale task leases when expired lease exists in capsule state", () => {
      const tempDir = join(tmpdir(), `test-lock-cleaner-stale-run-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const runDir = initRun(tempDir, "stale-lease-run", new Uint8Array(), "file", true);
        const stateFile = join(runDir, "state.json");
        const customState = {
          tasks: {
            "t-stale": {
              id: "t-stale",
              status: "leased",
              lease: {
                agent_id: "agent-x",
                role: "implementer",
                expires_at: "2020-01-01T00:00:00.000Z",
                token: "tok-1",
              },
            },
          },
        };
        writeFileSync(stateFile, JSON.stringify(customState));

        const recovered = recoverStaleLeases(runDir);
        expect(Array.isArray(recovered)).toBe(true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
