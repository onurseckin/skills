import { describe, expect, it } from "bun:test";
import {
  ProcessReclaimer,
  defaultIsProcessAlive,
  defaultSignalSender,
  defaultSleep,
  reclaimPort,
  reclaimProcess,
  reclaimZombieProcesses,
} from "../../../olt/scripts/src/server/process/index.ts";
import type { CommandExecutionResult } from "../../../olt/scripts/src/server/process/index.ts";

describe("process reclaimer subsystem - escalation logic and batch operations", () => {
  describe("reclaimProcess & escalation logic", () => {
    it("handles nonexistent PID cleanly without signaling", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      const result = await reclaimProcess(99999, 3000, {
        isAliveChecker: () => false,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
      });
      expect(result.pid).toBe(99999);
      expect(result.reclaimed).toBe(true);
      expect(result.signalSent).toBe("NONE");
      expect(signaled.length).toBe(0);
    });

    it("dry-run mode does not send signals and reports non-reclaimed", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => {
        if (cmd === "ps") {
          return { stdout: "1234 1 S 1000 Mon Aug 31 05:00:00 2026 node app.js\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const result = await reclaimProcess(1234, 3000, {
        dryRun: true,
        isAliveChecker: () => true,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
        execCommand: mockExec,
      });

      expect(result.pid).toBe(1234);
      expect(result.name).toBe("node");
      expect(result.reclaimed).toBe(false);
      expect(result.signalSent).toBe("NONE");
      expect(signaled.length).toBe(0);
    });

    it("force mode immediately sends SIGKILL and reclaims", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      let alive = true;

      const result = await reclaimProcess(5555, 8080, {
        force: true,
        isAliveChecker: () => alive,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          if (sig === "SIGKILL") alive = false;
          return true;
        },
        sleepFn: async () => {},
      });

      expect(result.pid).toBe(5555);
      expect(result.reclaimed).toBe(true);
      expect(result.signalSent).toBe("SIGKILL");
      expect(signaled).toEqual([{ pid: 5555, sig: "SIGKILL" }]);
    });

    it("graceful escalation terminates with SIGTERM if responsive", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      let checkCount = 0;

      const result = await reclaimProcess(7777, 3000, {
        gracePeriodMs: 500,
        pollIntervalMs: 10,
        isAliveChecker: () => {
          checkCount++;
          return checkCount <= 2;
        },
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
        sleepFn: async () => {},
      });

      expect(result.reclaimed).toBe(true);
      expect(result.signalSent).toBe("SIGTERM");
      expect(signaled).toEqual([{ pid: 7777, sig: "SIGTERM" }]);
    });

    it("graceful escalation escalates to SIGKILL if process ignores SIGTERM", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      let isDead = false;

      const result = await reclaimProcess(8888, 3000, {
        gracePeriodMs: 20,
        pollIntervalMs: 5,
        isAliveChecker: () => !isDead,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          if (sig === "SIGKILL") isDead = true;
          return true;
        },
        sleepFn: async (ms) => {
          await new Promise((r) => setTimeout(r, ms));
        },
      });

      expect(result.reclaimed).toBe(true);
      expect(result.signalSent).toBe("SIGKILL");
      expect(signaled).toEqual([
        { pid: 8888, sig: "SIGTERM" },
        { pid: 8888, sig: "SIGKILL" },
      ]);
    });

    it("reports error if process remains unkillable even after SIGKILL", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];

      const result = await reclaimProcess(9999, 3000, {
        gracePeriodMs: 10,
        pollIntervalMs: 5,
        isAliveChecker: () => true,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
        sleepFn: async (ms) => {
          await new Promise((r) => setTimeout(r, ms));
        },
      });

      expect(result.reclaimed).toBe(false);
      expect(result.signalSent).toBe("SIGKILL");
      expect(result.error).toBeDefined();
      expect(result.error).toContain("did not respond to SIGTERM or SIGKILL escalation");
    });

    it("fails fast immediately on EPERM without polling", async () => {
      let pollCount = 0;
      const start = performance.now();

      const result = await reclaimProcess(1, 80, {
        gracePeriodMs: 5000,
        pollIntervalMs: 10,
        isAliveChecker: () => true,
        signalSender: () => {
          const err = new Error("EPERM: operation not permitted");
          (err as Error & { code: string }).code = "EPERM";
          throw err;
        },
        sleepFn: async () => {
          pollCount++;
        },
      });

      const elapsed = performance.now() - start;
      expect(result.reclaimed).toBe(false);
      expect(result.error).toContain("Permission denied");
      expect(result.error).toContain("EPERM");
      expect(pollCount).toBe(0);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("batch reclaimer functions & ProcessReclaimer class", () => {
    it("reclaimPort reclaims all processes on a port", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") return { stdout: "101\n102\n", stderr: "", exitCode: 0 };
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const results = await reclaimPort(3000, {
        execCommand: mockExec,
        isAliveChecker: () => false,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
      });

      expect(results.length).toBe(2);
      expect(results[0]?.pid).toBe(101);
      expect(results[1]?.pid).toBe(102);
    });

    it("reclaimZombieProcesses only targets orphaned, zombie, or runtime processes", async () => {
      const signaled: Array<{ pid: number; sig: string }> = [];
      const mockExec = async (
        cmd: string,
        args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") return { stdout: "101\n102\n", stderr: "", exitCode: 0 };
        if (cmd === "ps") {
          if (args.includes("101")) {
            return { stdout: "101 1 S 1000 Mon Aug 31 05:00:00 2026 node app.js\n", stderr: "", exitCode: 0 };
          }
          if (args.includes("102")) {
            return { stdout: "102 5000 S 1000 Mon Aug 31 05:00:00 2026 /sbin/launchd\n", stderr: "", exitCode: 0 };
          }
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const results = await reclaimZombieProcesses([3000], {
        execCommand: mockExec,
        isAliveChecker: () => false,
        signalSender: (pid, sig) => {
          signaled.push({ pid, sig });
          return true;
        },
      });

      expect(results.length).toBe(1);
      expect(results[0]?.pid).toBe(101);
    });

    it("ProcessReclaimer class encapsulates all methods with defaults", async () => {
      const mockExec = async (
        cmd: string,
        _args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") return { stdout: "5050\n", stderr: "", exitCode: 0 };
        if (cmd === "ps") {
          return { stdout: "5050 1 S 5000 Mon Aug 31 05:00:00 2026 bun dev\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const reclaimer = new ProcessReclaimer({
        execCommand: mockExec,
        isAliveChecker: () => false,
      });

      const pids = await reclaimer.findPidsOnPort(3000);
      expect(pids).toEqual([5050]);

      const details = await reclaimer.getProcessDetails(5050);
      expect(details?.pid).toBe(5050);
      expect(details?.name).toBe("bun");

      const occupancy = await reclaimer.inspectPort(3000);
      expect(occupancy.port).toBe(3000);
      expect(occupancy.processes.length).toBe(1);

      const occupancies = await reclaimer.inspectPorts([3000]);
      expect(occupancies.length).toBe(1);

      const reclaimRes = await reclaimer.reclaim(5050, 3000);
      expect(reclaimRes.reclaimed).toBe(true);

      const reclaimPortRes = await reclaimer.reclaimPort(3000);
      expect(reclaimPortRes.length).toBe(1);

      const reclaimZombiesRes = await reclaimer.reclaimZombies([3000]);
      expect(reclaimZombiesRes.length).toBe(1);
    });

    it("default helpers execute without throwing", async () => {
      expect(defaultIsProcessAlive(process.pid)).toBe(true);
      expect(defaultIsProcessAlive(-1)).toBe(false);
      expect(defaultIsProcessAlive(0)).toBe(false);

      expect(defaultSignalSender(-1, "SIGTERM")).toBe(false);

      const start = Date.now();
      await defaultSleep(5);
      expect(Date.now() - start).toBeGreaterThanOrEqual(0);
    });
  });
});
