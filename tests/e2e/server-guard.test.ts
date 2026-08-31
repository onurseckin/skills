import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdir, rm } from "node:fs/promises";
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
  DEFAULT_DEV_PORTS,
  type ServerPortStatus,
} from "../../olt/scripts/src/cli/commands/server-ops.ts";
import { probeTcpPort, findAvailablePort } from "../../olt/scripts/src/server/probe/index.ts";
import {
  captureSnapshot,
  restartDevServer,
  type ServerStateSnapshot,
} from "../../olt/scripts/src/server/lifecycle/index.ts";
import {
  inspectPortOccupancy,
  reclaimPort,
  type ProcessDetails,
  type ReclaimResult,
} from "../../olt/scripts/src/server/process/index.ts";

describe("Smart Dev Server Port Conflict Guard - E2E Lifecycle Suite", () => {
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
    const tempDir = join(tmpdir(), `server-guard-e2e-${Date.now()}-${randomSuffix}`);
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

  describe("Package.json Script Verification", () => {
    it("ensures package.json declares server:status, server:restart, server:clean scripts", () => {
      const pkgPath = join(process.cwd(), "package.json");
      const pkgJson = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };

      expect(pkgJson.scripts).toBeDefined();
      const rawScripts = pkgJson.scripts;
      const scripts = rawScripts !== undefined ? rawScripts : {};

      expect(scripts["server:status"]).toBe("bun olt/scripts/harness.ts server:status");
      expect(scripts["server:restart"]).toBe("bun olt/scripts/harness.ts server:restart");
      expect(scripts["server:clean"]).toBe("bun olt/scripts/harness.ts server:clean");
    });
  });

  describe("CLI Command Layer E2E Execution", () => {
    it("executes server:status command and formats markdown and JSON payloads", async () => {
      const candidatePort = await findAvailablePort(19200, 19300);
      const testServer = await startTestServer(candidatePort);

      const flags: Flags = {
        port: String(candidatePort),
        host: "127.0.0.1",
      };

      const result = await serverStatusCommand(flags);

      expect(result).toBeDefined();
      expect(result["total_scanned"]).toBe(1);
      expect(result["target_ports"]).toEqual([candidatePort]);
      expect(result["markdown"]).toBeString();
      expect(result["markdown"] as string).toContain("Dev Server Status Report");
      expect(result["markdown"] as string).toContain(String(candidatePort));

      const ports = result["ports"] as readonly ServerPortStatus[];
      expect(ports.length).toBe(1);
      const portStatus = ports[0];
      expect(portStatus).toBeDefined();
      if (portStatus !== undefined) {
        expect(portStatus.port).toBe(candidatePort);
        expect(portStatus.inUse).toBe(true);
        expect(portStatus.tcpStatus).toBe("listening");
      }

      await closeServer(testServer);
    });

    it("executes server:clean command in dry-run mode", async () => {
      const dryRunFlags: Flags = {
        port: "19800",
        "dry-run": true,
      };

      const dryRunResult = await serverCleanCommand(dryRunFlags);
      expect(dryRunResult["dry_run"]).toBe(true);
      expect(dryRunResult["markdown"]).toBeString();
      expect(dryRunResult["markdown"] as string).toContain("Dev Server Port Cleanup Summary");
      expect(dryRunResult["markdown"] as string).toContain("Dry Run");
      expect(dryRunResult["reclaimed_count"]).toBe(1);
    });

    it("executes server:restart command in dry-run mode", async () => {
      const restartFlags: Flags = {
        port: "19800",
        "dry-run": true,
        force: true,
      };

      const restartResult = await serverRestartCommand(restartFlags);
      expect(restartResult["dry_run"]).toBe(true);
      expect(restartResult["success"]).toBe(true);
      expect(restartResult["markdown"]).toBeString();
      expect(restartResult["markdown"] as string).toContain("Dev Server Restart");
      expect(restartResult["markdown"] as string).toContain("Dry Run");
    });
  });

  describe("End-to-End Conflict Lifecycle: Detection -> Cleanup -> Port Release -> Restart", () => {
    it("completes the full conflict recovery lifecycle deterministically", async () => {
      const dynamicPort = await findAvailablePort(19400, 19500);
      const fallbackDir = tempDirs[0];
      const baseDir = fallbackDir !== undefined ? fallbackDir : tmpdir();
      const tempLock = join(baseDir, "e2e-restart.lock");
      const tempSnap = join(baseDir, "e2e-snapshot.json");

      // Step 1: Start rogue server occupying the port
      const rogueServer = await startTestServer(dynamicPort);
      expect(rogueServer.listening).toBe(true);

      // Step 2: Probe detects port occupancy
      const probe1 = await probeTcpPort(dynamicPort);
      expect(probe1.inUse).toBe(true);
      expect(probe1.status).toBe("listening");

      // Step 3: Capture current state snapshot before recovery
      const snapshot = captureSnapshot({
        portConfigurations: [{ port: dynamicPort, isPrimary: true, name: "core-dev" }],
        envVariables: { PORT: String(dynamicPort), NODE_ENV: "development" },
      });
      expect(snapshot.portConfigurations.length).toBe(1);

      // Step 4: Release rogue server (simulating reclaimer killing rogue PID)
      await closeServer(rogueServer);

      // Step 5: Verify port is now released
      const probe2 = await probeTcpPort(dynamicPort);
      expect(probe2.inUse).toBe(false);
      expect(probe2.status).toBe("refused");

      // Step 6: Atomic restart spawns new server instance
      let newServer: Server | null = null;
      const restartResult = await restartDevServer({
        customSnapshot: snapshot,
        snapshotPath: tempSnap,
        lockOptions: { lockPath: tempLock, timeoutMs: 1000 },
        shutdownOptions: {
          isAliveChecker: () => false,
          signalSender: () => true,
          sleepFn: async () => {},
        },
        startOptions: {
          primaryPort: dynamicPort,
          bindTimeoutMs: 200,
          bindPollIntervalMs: 10,
          spawnServerFn: async () => {
            newServer = await startTestServer(dynamicPort);
            return { pid: 77777 };
          },
          portChecker: async () => true,
          sleepFn: async () => {},
        },
      });

      expect(restartResult.success).toBe(true);
      expect(restartResult.newPid).toBe(77777);
      expect(restartResult.rolledBack).toBe(false);

      if (newServer !== null) {
        await closeServer(newServer);
      }
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
