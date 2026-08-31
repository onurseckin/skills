import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  probeTcpPort,
  isPortInUse,
  detectSocketConflict,
  inspectComprehensivePort,
  findAvailablePort,
} from "../../olt/scripts/src/server/probe/index.ts";
import {
  detectDockerPortConflicts,
  inspectRunningContainers,
  parseDockerPsOutput,
  type DockerContainerConflict,
  type DockerInspectorOptions,
} from "../../olt/scripts/src/server/docker/index.ts";
import {
  ProcessReclaimer,
  findPidsOnPort,
  inspectPortOccupancy,
  reclaimPort,
  reclaimProcess,
  reclaimZombieProcesses,
  type CommandExecutionResult,
  type ProcessDetails,
} from "../../olt/scripts/src/server/process/index.ts";
import {
  acquireLock,
  captureSnapshot,
  DevServerLifecycleManager,
  restartDevServer,
  startServer,
  withRestartLock,
  type ServerStateSnapshot,
} from "../../olt/scripts/src/server/lifecycle/index.ts";

describe("Server Conflict Guard - Multi-Lane Integration Suite", () => {
  const activeServers = new Set<Server>();
  const tempDirs: string[] = [];

  const startTestServer = (port: number): Promise<Server> => {
    return new Promise<Server>((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.listen(port, "127.0.0.1", () => {
        activeServers.add(server);
        resolve(server);
      });
      server.on("error", (err) => {
        reject(err);
      });
    });
  };

  const closeServer = (server: Server): Promise<void> => {
    activeServers.delete(server);
    return new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      try {
        server.close(() => {
          resolve();
        });
        server.unref();
      } catch {
        resolve();
      }
    });
  };

  beforeEach(async () => {
    const randomSuffix = Math.random().toString(36).slice(2);
    const tempDir = join(tmpdir(), `server-conflict-int-${Date.now()}-${randomSuffix}`);
    await mkdir(tempDir, { recursive: true });
    tempDirs.push(tempDir);
  });

  afterEach(async () => {
    for (const server of Array.from(activeServers)) {
      await closeServer(server);
    }
    for (const dir of tempDirs.splice(0)) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      await rm(join(process.cwd(), ".locks"), { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Lane 1 (TCP Probe) & Lane 3 (Process Reclaimer) Interoperability", () => {
    it("detects listening socket via probe and inspects process occupancy", async () => {
      // Find an available port dynamically
      const candidatePort = await findAvailablePort(19000, 20000);
      expect(candidatePort).toBeGreaterThan(0);

      // Verify port is free initially
      const initialProbe = await probeTcpPort(candidatePort);
      expect(initialProbe.inUse).toBe(false);
      expect(initialProbe.status).toBe("refused");

      // Start actual listening server
      const server = await startTestServer(candidatePort);
      expect(server.listening).toBe(true);

      // Verify probe detects port is occupied
      const occupiedProbe = await probeTcpPort(candidatePort);
      expect(occupiedProbe.inUse).toBe(true);
      expect(occupiedProbe.status).toBe("listening");

      // Verify socket conflict detection detects binding collision
      const conflictResult = await detectSocketConflict(candidatePort);
      expect(conflictResult.inUse).toBe(true);
      expect(conflictResult.available).toBe(false);

      // Inspect comprehensive port status
      const comprehensive = await inspectComprehensivePort(candidatePort);
      expect(comprehensive.inUse).toBe(true);
      expect(comprehensive.available).toBe(false);

      // Close server and verify port becomes available again
      await closeServer(server);
      const afterCloseProbe = await probeTcpPort(candidatePort);
      expect(afterCloseProbe.inUse).toBe(false);
    });

    it("reclaims port occupancy using mock process reclaimer workflow", async () => {
      const testPort = 19100;
      let targetAlive = true;
      const killedSignals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];

      const mockExec = async (
        cmd: string,
        _args: readonly string[],
      ): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return {
            stdout: targetAlive ? "12345\n" : "",
            stderr: "",
            exitCode: targetAlive ? 0 : 1,
          };
        }
        if (cmd === "ps") {
          return {
            stdout: targetAlive ? "12345 1 S 50000 /usr/local/bin/node /app/server.js\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

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
      const firstResult = result[0];
      expect(firstResult).toBeDefined();
      if (firstResult !== undefined) {
        expect(firstResult.pid).toBe(12345);
        expect(firstResult.reclaimed).toBe(true);
        expect(firstResult.signalSent).toBe("SIGTERM");
      }
      expect(killedSignals.length).toBe(1);
      expect(targetAlive).toBe(false);
    });

    it("escalates from SIGTERM to SIGKILL when process resists graceful shutdown", async () => {
      const testPort = 19101;
      let targetAlive = true;
      let sigtermAttempts = 0;
      const signalHistory: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];

      const mockExec = async (cmd: string): Promise<CommandExecutionResult> => {
        if (cmd === "lsof") {
          return { stdout: targetAlive ? "54321\n" : "", stderr: "", exitCode: 0 };
        }
        return { stdout: "54321 1 S 50000 node server.js\n", stderr: "", exitCode: 0 };
      };

      const result = await reclaimProcess(54321, testPort, {
        execCommand: mockExec,
        isAliveChecker: (pid: number) => {
          if (pid === 54321) {
            return targetAlive;
          }
          return false;
        },
        signalSender: (pid: number, sig: "SIGTERM" | "SIGKILL") => {
          signalHistory.push({ pid, signal: sig });
          if (sig === "SIGTERM") {
            sigtermAttempts++;
            // Remain alive after SIGTERM
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
      const mockInspectJson = JSON.stringify([
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

      const containers = parseDockerPsOutput(mockInspectJson);
      expect(containers.length).toBe(1);
      const container = containers[0];
      expect(container).toBeDefined();
      if (container !== undefined) {
        expect(container.containerName).toBe("test-postgres-dev");
        expect(container.portMappings.length).toBe(2);
        expect(container.portMappings.some((p) => p.hostPort === 3000)).toBe(true);
      }

      // Check conflicts across monitored dev ports
      const mockRunner = (_cmd: string, _args: readonly string[]) => {
        return {
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
        };
      };

      const conflictScan = detectDockerPortConflicts([3000, 8080], {
        runner: mockRunner,
      });

      expect(conflictScan.hasConflict).toBe(true);
      expect(conflictScan.conflicts.length).toBe(1);
      const conflict = conflictScan.conflicts[0];
      expect(conflict).toBeDefined();
      if (conflict !== undefined) {
        expect(conflict.hostPort).toBe(3000);
        expect(conflict.containerName).toBe("test-postgres-dev");
        expect(conflict.containerPort).toBe(3000);
      }
    });

    it("handles docker daemon absence gracefully without throwing", () => {
      const mockFailingRunner = () => ({
        status: 1,
        stdout: "",
        stderr:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      });

      const result = detectDockerPortConflicts([3000, 5173], {
        runner: mockFailingRunner,
      });

      expect(result).toBeDefined();
      expect(result.conflicts).toEqual([]);
      expect(result.hasConflict).toBe(false);
      expect(result.isDockerAvailable).toBe(false);
    });
  });

  describe("Lane 3 (Process Reclaimer) & Lane 4 (Lifecycle Manager) Integration", () => {
    it("takes state snapshot, reclaims old PID, and executes server restart", async () => {
      const fallbackDir = tempDirs[0];
      const baseDir = fallbackDir !== undefined ? fallbackDir : tmpdir();
      const tempLockPath = join(baseDir, "restart.lock");
      let oldProcessAlive = true;
      let newServerSpawned = false;

      // 1. Capture snapshot of running server state
      const initialSnapshot: ServerStateSnapshot = captureSnapshot({
        currentPid: 9876,
        portConfigurations: [{ port: 3000, isPrimary: true, name: "vite-dev" }],
        envVariables: { NODE_ENV: "development", PORT: "3000" },
        runFlags: { port: 3000, mode: "development" },
      });

      expect(initialSnapshot.currentPid).toBe(9876);
      expect(initialSnapshot.portConfigurations.length).toBe(1);

      // 2. Perform atomic restart with lock, shutdown, and mock spawn
      const restartResult = await restartDevServer({
        oldPid: 9876,
        customSnapshot: initialSnapshot,
        lockOptions: { lockPath: tempLockPath, timeoutMs: 2000 },
        shutdownOptions: {
          gracePeriodMs: 100,
          isAliveChecker: (pid) => (pid === 9876 ? oldProcessAlive : false),
          signalSender: (pid, _sig) => {
            if (pid === 9876) {
              oldProcessAlive = false;
              return true;
            }
            return false;
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
      const fallbackDir = tempDirs[0];
      const baseDir = fallbackDir !== undefined ? fallbackDir : tmpdir();
      const tempLockPath = join(baseDir, "rollback.lock");
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
        shutdownOptions: {
          isAliveChecker: () => false,
          signalSender: () => true,
        },
        startOptions: {
          primaryPort: 3000,
          bindTimeoutMs: 100,
          bindPollIntervalMs: 20,
          portChecker: async () => false, // Simulate failure to bind port
          spawnServerFn: async () => ({ pid: 8888 }),
          sleepFn: async () => {},
        },
        restoreOldServerFn: async (_snapshot) => {
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
      const fallbackDir = tempDirs[0];
      const baseDir = fallbackDir !== undefined ? fallbackDir : tmpdir();
      const sharedLockPath = join(baseDir, "concurrent.lock");
      const executionOrder: string[] = [];

      const job1 = withRestartLock(
        async () => {
          executionOrder.push("job1-start");
          await new Promise((resolve) => setTimeout(resolve, 50));
          executionOrder.push("job1-end");
          return "result-1";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000 },
      );

      const job2 = withRestartLock(
        async () => {
          executionOrder.push("job2-start");
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionOrder.push("job2-end");
          return "result-2";
        },
        { lockPath: sharedLockPath, timeoutMs: 1000 },
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
          return {
            stdout: Array.from(alivePids).join("\n") + "\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (cmd === "ps") {
          const targetPid = args[1];
          const command =
            targetPid === "1001" ? "/usr/local/bin/node server.js" : "/usr/local/bin/bun run dev";
          return {
            stdout: `${targetPid} 1 S 50000 ${command}\n`,
            stderr: "",
            exitCode: 0,
          };
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
