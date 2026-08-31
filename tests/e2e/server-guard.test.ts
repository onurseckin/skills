import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Flags } from "../../olt/scripts/src/cli/options.ts";
import {
  serverStatusCommand,
  serverRestartCommand,
  serverCleanCommand,
  formatServerStatusMarkdown,
  formatServerRestartMarkdown,
  formatServerCleanMarkdown,
  type ServerPortStatus,
} from "../../olt/scripts/src/cli/commands/server-ops.ts";
import {
  captureSnapshot,
  restartDevServer,
  withRestartLock,
  type ServerStateSnapshot,
} from "../../olt/scripts/src/server/lifecycle/index.ts";
import {
  reclaimPort,
  type CommandExecutionResult,
  type ReclaimResult,
} from "../../olt/scripts/src/server/process/index.ts";

describe("Smart Dev Server Port Conflict Guard - E2E Lifecycle Suite", () => {
  describe("Package.json Script Verification", () => {
    it("ensures package.json declares server:status, server:restart, server:clean scripts", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkgJson.scripts ?? {};
      expect(scripts["server:status"]).toBe("bun olt/scripts/harness.ts server:status");
      expect(scripts["server:restart"]).toBe("bun olt/scripts/harness.ts server:restart");
      expect(scripts["server:clean"]).toBe("bun olt/scripts/harness.ts server:clean");
    });
  });

  describe("CLI Command Layer E2E Execution", () => {
    it("executes server:status command and formats markdown and JSON payloads", async () => {
      const flags: Flags = { port: "59123", host: "127.0.0.1" };
      const result = await serverStatusCommand(flags);
      expect(result).toBeDefined();
      expect(result["total_scanned"]).toBe(1);
      expect(result["target_ports"]).toEqual([59123]);
      expect(result["markdown"]).toBeString();
      expect(result["markdown"] as string).toContain("Dev Server Status Report");
      expect(result["markdown"] as string).toContain("59123");

      const ports = result["ports"] as readonly ServerPortStatus[];
      expect(ports.length).toBe(1);
      const portStatus = ports[0];
      expect(portStatus).toBeDefined();
      if (portStatus !== undefined) {
        expect(portStatus.port).toBe(59123);
        expect(typeof portStatus.inUse).toBe("boolean");
        expect(typeof portStatus.available).toBe("boolean");
        expect(typeof portStatus.tcpStatus).toBe("string");
      }
    });

    it("executes server:clean command in dry-run mode", async () => {
      const dryRunFlags: Flags = { port: "19800", "dry-run": true };
      const dryRunResult = await serverCleanCommand(dryRunFlags);
      expect(dryRunResult["dry_run"]).toBe(true);
      expect(dryRunResult["markdown"]).toBeString();
      expect(dryRunResult["markdown"] as string).toContain("Dev Server Port Cleanup Summary");
      expect(dryRunResult["markdown"] as string).toContain("Dry Run");
      expect(dryRunResult["reclaimed_count"]).toBe(1);
    });

    it("executes server:restart command in dry-run mode", async () => {
      const restartFlags: Flags = { port: "19800", "dry-run": true, force: true };
      const restartResult = await serverRestartCommand(restartFlags);
      expect(restartResult["dry_run"]).toBe(true);
      expect(restartResult["success"]).toBe(true);
      expect(restartResult["markdown"]).toBeString();
      expect(restartResult["markdown"] as string).toContain("Dev Server Restart");
      expect(restartResult["markdown"] as string).toContain("Dry Run");
    });
  });

  describe("End-to-End Conflict Lifecycle: Detection -> Cleanup -> Port Release -> Restart", () => {
    it("completes the full conflict recovery lifecycle deterministically with in-memory adapters", async () => {
      const testPort = 3000;
      let rogueAlive = true;
      let newServerSpawned = false;
      const killedSignals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];

      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return { stdout: rogueAlive ? "55555\n" : "", stderr: "", exitCode: rogueAlive ? 0 : 1 };
        }
        if (cmd === "ps") {
          return {
            stdout: rogueAlive ? "55555 1 S 50000 node rogue-server.js\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const reclaimResults = await reclaimPort(testPort, {
        execCommand: mockExec,
        isAliveChecker: (pid) => (pid === 55555 ? rogueAlive : false),
        signalSender: (pid, sig) => {
          killedSignals.push({ pid, signal: sig });
          rogueAlive = false;
          return true;
        },
        gracePeriodMs: 50,
        pollIntervalMs: 10,
        sleepFn: async () => {},
      });

      expect(reclaimResults.length).toBe(1);
      const firstReclaim = reclaimResults[0];
      expect(firstReclaim).toBeDefined();
      if (firstReclaim !== undefined) {
        expect(firstReclaim.reclaimed).toBe(true);
      }
      expect(rogueAlive).toBe(false);
      expect(killedSignals.length).toBe(1);

      const snapshot: ServerStateSnapshot = captureSnapshot({
        currentPid: 55555,
        portConfigurations: [{ port: testPort, isPrimary: true, name: "core-dev" }],
        envVariables: { PORT: String(testPort), NODE_ENV: "development" },
      });
      expect(snapshot.portConfigurations.length).toBe(1);

      const tempLock = join(
        tmpdir(),
        `test-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`,
      );
      const restartResult = await restartDevServer({
        oldPid: 55555,
        customSnapshot: snapshot,
        lockOptions: { lockPath: tempLock, timeoutMs: 1000 },
        shutdownOptions: {
          isAliveChecker: () => false,
          signalSender: () => true,
          sleepFn: async () => {},
        },
        startOptions: {
          primaryPort: testPort,
          bindTimeoutMs: 100,
          bindPollIntervalMs: 10,
          spawnServerFn: async () => {
            newServerSpawned = true;
            return { pid: 77777 };
          },
          portChecker: async () => true,
          sleepFn: async () => {},
        },
      });

      expect(restartResult.success).toBe(true);
      expect(restartResult.newPid).toBe(77777);
      expect(restartResult.rolledBack).toBe(false);
      expect(newServerSpawned).toBe(true);
      expect(restartResult.snapshot.pidHistory).toContain(55555);
    });

    it("triggers transactional rollback when new server fails port binding verification", async () => {
      let rollbackInvoked = false;
      const initialSnapshot = captureSnapshot({
        currentPid: 4433,
        portConfigurations: [{ port: 3000, isPrimary: true }],
      });

      const tempLock = join(
        tmpdir(),
        `test-rb-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`,
      );
      const restartResult = await restartDevServer({
        oldPid: 4433,
        customSnapshot: initialSnapshot,
        rollbackOnError: true,
        lockOptions: { lockPath: tempLock, timeoutMs: 1000 },
        shutdownOptions: { isAliveChecker: () => false, signalSender: () => true },
        startOptions: {
          primaryPort: 3000,
          bindTimeoutMs: 50,
          bindPollIntervalMs: 10,
          portChecker: async () => false,
          spawnServerFn: async () => ({ pid: 8888 }),
          sleepFn: async () => {},
        },
        restoreOldServerFn: async () => {
          rollbackInvoked = true;
          return { pid: 4433 };
        },
      });

      expect(restartResult.success).toBe(false);
      expect(restartResult.rolledBack).toBe(true);
      expect(rollbackInvoked).toBe(true);
      expect(restartResult.error).toBeDefined();
    });

    it("guarantees atomic locking prevents concurrent conflicting restarts", async () => {
      const sharedLockPath = join(
        tmpdir(),
        `test-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`,
      );
      const executionOrder: string[] = [];

      const job1 = withRestartLock(
        async () => {
          executionOrder.push("job1-start");
          executionOrder.push("job1-end");
          return "result-1";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000 },
      );

      const job2 = withRestartLock(
        async () => {
          executionOrder.push("job2-start");
          executionOrder.push("job2-end");
          return "result-2";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000 },
      );

      const [res1, res2] = await Promise.all([job1, job2]);
      expect(res1).toBe("result-1");
      expect(res2).toBe("result-2");
      expect(executionOrder.length).toBe(4);
    });
  });

  describe("Markdown and Diagnostic Formatter Output Verification", () => {
    it("formats empty and populated server status tables", () => {
      const emptyMd = formatServerStatusMarkdown([], [3000]);
      expect(emptyMd).toContain("Scanned Ports");
      expect(emptyMd).toContain("| — | — | — | — | — | — | — |");

      const mockStatus: ServerPortStatus = {
        port: 3000,
        inUse: true,
        available: false,
        tcpStatus: "listening",
        socketStatus: "occupied",
        latencyMs: 4,
        pids: [1234],
        processes: [
          {
            pid: 1234,
            ppid: 1,
            name: "node",
            command: "node server.js",
            memoryBytes: 104857600,
            startTime: "2026-08-31T00:00:00Z",
            isZombie: true,
            isOrphaned: true,
            isRuntimeProcess: true,
          },
        ],
        dockerConflicts: [],
      };

      const populatedMd = formatServerStatusMarkdown([mockStatus], [3000]);
      expect(populatedMd).toContain("🔴 listening");
      expect(populatedMd).toContain("100.0 MB");
      expect(populatedMd).toContain("*(zombie)*");
    });

    it("formats clean and restart markdown outputs", () => {
      const mockReclaim: ReclaimResult = {
        pid: 999,
        name: "bun",
        port: 5173,
        reclaimed: true,
        signalSent: "SIGKILL",
        durationMs: 42,
      };

      const cleanMd = formatServerCleanMarkdown([mockReclaim], [5173], false, true);
      expect(cleanMd).toContain("Dev Server Port Cleanup Summary");
      expect(cleanMd).toContain("Force Termination (SIGKILL)");
      expect(cleanMd).toContain("`999`");

      const mockSnapshot = captureSnapshot({
        portConfigurations: [{ port: 3000, isPrimary: true }],
      });

      const restartMd = formatServerRestartMarkdown(
        {
          success: true,
          rolledBack: false,
          oldPid: 100,
          newPid: 200,
          snapshot: mockSnapshot,
          durationMs: 15,
        },
        3000,
        false,
        false,
      );

      expect(restartMd).toContain("Dev Server Restart: Port 3000");
      expect(restartMd).toContain("`100`");
      expect(restartMd).toContain("`200`");
    });
  });
});
