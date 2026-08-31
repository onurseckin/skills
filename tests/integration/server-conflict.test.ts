import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectDockerPortConflicts,
  parseDockerPsOutput,
} from "../../olt/scripts/src/server/docker/index.ts";
import {
  ProcessReclaimer,
  findPidsOnPort,
  inspectPortOccupancy,
  reclaimPort,
  reclaimProcess,
  type CommandExecutionResult,
} from "../../olt/scripts/src/server/process/index.ts";
import {
  captureSnapshot,
  restartDevServer,
  withRestartLock,
  type ServerStateSnapshot,
} from "../../olt/scripts/src/server/lifecycle/index.ts";

describe("Server Conflict Guard - Multi-Lane Integration Suite", () => {
  const createTempLockPath = (label: string): string =>
    join(tmpdir(), `sc-int-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`);

  describe("Lane 1 (TCP Probe) & Lane 3 (Process Reclaimer) Interoperability", () => {
    it("correlates port occupancy inspection with process reclaimer execution", async () => {
      const testPort = 19100;
      let targetAlive = true;
      const killedSignals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];

      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => ({
        stdout:
          cmd === "lsof"
            ? targetAlive
              ? "12345\n"
              : ""
            : targetAlive
              ? "12345 1 S 50000 node /app/server.js\n"
              : "",
        stderr: "",
        exitCode: cmd === "lsof" ? (targetAlive ? 0 : 1) : 0,
      });

      expect(await findPidsOnPort(testPort, { execCommand: mockExec })).toEqual([12345]);
      const occ = await inspectPortOccupancy(testPort, { execCommand: mockExec });
      expect(occ.port).toBe(testPort);
      expect(occ.pids).toEqual([12345]);
      expect(occ.processes.length).toBe(1);

      const result = await reclaimPort(testPort, {
        execCommand: mockExec,
        isAliveChecker: (pid: number) => (pid === 12345 ? targetAlive : false),
        signalSender: (pid: number, sig: "SIGTERM" | "SIGKILL") => {
          killedSignals.push({ pid, signal: sig });
          targetAlive = false;
          return true;
        },
        gracePeriodMs: 200,
        pollIntervalMs: 20,
        sleepFn: async () => {},
      });

      expect(result.length).toBe(1);
      expect(result[0]?.pid).toBe(12345);
      expect(result[0]?.reclaimed).toBe(true);
      expect(result[0]?.signalSent).toBe("SIGTERM");
      expect(killedSignals.length).toBe(1);
      expect(targetAlive).toBe(false);
      expect(await findPidsOnPort(testPort, { execCommand: mockExec })).toEqual([]);
    });

    it("escalates from SIGTERM to SIGKILL when process resists graceful shutdown", async () => {
      const testPort = 19101;
      let targetAlive = true;
      let sigtermAttempts = 0;
      const signalHistory: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];

      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => ({
        stdout:
          cmd === "lsof" ? (targetAlive ? "54321\n" : "") : "54321 1 S 50000 node server.js\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await reclaimProcess(54321, testPort, {
        execCommand: mockExec,
        isAliveChecker: (pid: number) => (pid === 54321 ? targetAlive : false),
        signalSender: (pid: number, sig: "SIGTERM" | "SIGKILL") => {
          signalHistory.push({ pid, signal: sig });
          if (sig === "SIGTERM") {
            sigtermAttempts++;
            return true;
          }
          if (sig === "SIGKILL") {
            targetAlive = false;
            return true;
          }
          return false;
        },
        gracePeriodMs: 60,
        pollIntervalMs: 20,
        sleepFn: async () => {},
      });

      expect(result.reclaimed).toBe(true);
      expect(result.signalSent).toBe("SIGKILL");
      expect(sigtermAttempts).toBeGreaterThanOrEqual(1);
      expect(signalHistory.some((s) => s.signal === "SIGKILL")).toBe(true);
      expect(targetAlive).toBe(false);
    });
  });

  describe("Lane 2 (Docker Inspector) & Multi-Lane Collision Detection", () => {
    it("parses docker container mappings and correlates with host port status", () => {
      const mockJson = JSON.stringify([
        {
          Id: "c1234567890abcdef",
          Name: "/test-postgres-dev",
          State: { Running: true, Status: "running" },
          Ports: [
            { HostPort: 5432, ContainerPort: 5432, Type: "tcp", IP: "0.0.0.0" },
            { HostPort: 3000, ContainerPort: 3000, Type: "tcp", IP: "127.0.0.1" },
          ],
          Config: { Image: "postgres:16-alpine" },
          Created: "2026-08-31T10:00:00.000Z",
        },
      ]);

      const containers = parseDockerPsOutput(mockJson);
      expect(containers.length).toBe(1);
      expect(containers[0]?.containerName).toBe("test-postgres-dev");
      expect(containers[0]?.portMappings.length).toBe(2);
      expect(containers[0]?.portMappings.some((p) => p.hostPort === 3000)).toBe(true);

      const mockRunner = () => ({
        status: 0,
        stdout:
          JSON.stringify({
            ID: "c1234567890a",
            Image: "postgres:16-alpine",
            Status: "Up 2 hours",
            Ports: "0.0.0.0:5432->5432/tcp, 127.0.0.1:3000->3000/tcp",
            Names: "test-postgres-dev",
          }) + "\n",
        stderr: "",
      });

      const scan = detectDockerPortConflicts([3000, 8080], { runner: mockRunner });
      expect(scan.hasConflict).toBe(true);
      expect(scan.conflicts.length).toBe(1);
      expect(scan.conflicts[0]?.hostPort).toBe(3000);
      expect(scan.conflicts[0]?.containerName).toBe("test-postgres-dev");
      expect(scan.conflicts[0]?.containerPort).toBe(3000);
    });

    it("handles docker daemon absence gracefully without throwing", () => {
      const mockFail = () => ({
        status: 1,
        stdout: "",
        stderr: "Cannot connect to Docker daemon at unix:///var/run/docker.sock",
      });
      const result = detectDockerPortConflicts([3000, 5173], { runner: mockFail });
      expect(result.conflicts).toEqual([]);
      expect(result.hasConflict).toBe(false);
      expect(result.isDockerAvailable).toBe(false);
    });
  });

  describe("Lane 3 (Process Reclaimer) & Lane 4 (Lifecycle Manager) Integration", () => {
    it("takes state snapshot, reclaims old PID, and executes server restart", async () => {
      const tempLockPath = createTempLockPath("restart");
      let oldProcessAlive = true;
      let newServerSpawned = false;

      const initialSnapshot: ServerStateSnapshot = captureSnapshot({
        currentPid: 9876,
        portConfigurations: [{ port: 3000, isPrimary: true, name: "vite-dev" }],
        envVariables: { NODE_ENV: "development", PORT: "3000" },
        runFlags: { port: 3000, mode: "development" },
      });

      expect(initialSnapshot.currentPid).toBe(9876);
      expect(initialSnapshot.portConfigurations.length).toBe(1);

      const restartResult = await restartDevServer({
        oldPid: 9876,
        customSnapshot: initialSnapshot,
        lockOptions: { lockPath: tempLockPath, timeoutMs: 2000 },
        shutdownOptions: {
          gracePeriodMs: 100,
          isAliveChecker: (pid) => (pid === 9876 ? oldProcessAlive : false),
          signalSender: (pid) => {
            if (pid === 9876) oldProcessAlive = false;
            return true;
          },
          sleepFn: async () => {},
        },
        startOptions: {
          primaryPort: 3000,
          spawnServerFn: async () => {
            newServerSpawned = true;
            return { pid: 9999 };
          },
          portChecker: async () => true,
        },
      });

      expect(restartResult.success).toBe(true);
      expect(restartResult.rolledBack).toBe(false);
      expect(restartResult.newPid).toBe(9999);
      expect(restartResult.oldPid).toBe(9876);
      expect(oldProcessAlive).toBe(false);
      expect(newServerSpawned).toBe(true);
      expect(restartResult.snapshot.pidHistory).toContain(9876);
    });

    it("triggers rollback when new server fails port binding verification", async () => {
      const tempLockPath = createTempLockPath("rollback");
      let rollbackInvoked = false;

      const initialSnapshot = captureSnapshot({
        currentPid: 4433,
        portConfigurations: [{ port: 3000, isPrimary: true }],
      });

      const restartResult = await restartDevServer({
        oldPid: 4433,
        customSnapshot: initialSnapshot,
        rollbackOnError: true,
        lockOptions: { lockPath: tempLockPath, timeoutMs: 2000 },
        shutdownOptions: { isAliveChecker: () => false, signalSender: () => true },
        startOptions: {
          primaryPort: 3000,
          bindTimeoutMs: 100,
          bindPollIntervalMs: 20,
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
  });

  describe("Multi-Lane Concurrency & Race Condition Guarding", () => {
    it("guarantees atomic locking prevents concurrent conflicting restarts", async () => {
      const sharedLockPath = createTempLockPath("concurrent");
      const executionOrder: string[] = [];

      const job1 = withRestartLock(
        async () => {
          executionOrder.push("job1-start");
          await Promise.resolve();
          executionOrder.push("job1-end");
          return "result-1";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000, pollIntervalMs: 10 },
      );

      const job2 = withRestartLock(
        async () => {
          executionOrder.push("job2-start");
          await Promise.resolve();
          executionOrder.push("job2-end");
          return "result-2";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000, pollIntervalMs: 10 },
      );

      const [res1, res2] = await Promise.all([job1, job2]);
      expect(res1).toBe("result-1");
      expect(res2).toBe("result-2");
      if (executionOrder[0] === "job1-start") {
        expect(executionOrder).toEqual(["job1-start", "job1-end", "job2-start", "job2-end"]);
      } else {
        expect(executionOrder).toEqual(["job2-start", "job2-end", "job1-start", "job1-end"]);
      }
    });

    it("cleans up zombie processes across multiple target ports simultaneously", async () => {
      let lsofCalled = false;
      const alivePids = new Set([1001, 1002]);

      const mockExec = async (
        cmd: string,
        args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          lsofCalled = true;
          return { stdout: Array.from(alivePids).join("\n") + "\n", stderr: "", exitCode: 0 };
        }
        if (cmd === "ps") {
          const targetPid = args[1];
          const command =
            targetPid === "1001" ? "/usr/local/bin/node server.js" : "/usr/local/bin/bun run dev";
          return { stdout: `${targetPid} 1 S 50000 ${command}\n`, stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const reclaimer = new ProcessReclaimer({
        execCommand: mockExec,
        isAliveChecker: (pid) => alivePids.has(pid),
        signalSender: (pid) => {
          alivePids.delete(pid);
          return true;
        },
        gracePeriodMs: 50,
        pollIntervalMs: 10,
        sleepFn: async () => {},
      });

      const reclaims = await reclaimer.reclaimZombies([3000]);
      expect(reclaims.length).toBe(2);
      expect(reclaims.every((r) => r.reclaimed)).toBe(true);
      expect(alivePids.size).toBe(0);
      expect(lsofCalled).toBe(true);
    });
  });
});
