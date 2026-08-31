import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DEV_PORTS,
  formatServerCleanMarkdown,
  formatServerRestartMarkdown,
  formatServerStatusMarkdown,
  serverCleanCommand,
  serverRestartCommand,
  serverStatusCommand,
  type ServerPortStatus,
} from "../../olt/scripts/src/cli/commands/server-ops.ts";
import { SERVER_COMMANDS } from "../../olt/scripts/src/cli/registry/server.ts";
import type {
  ProcessDetails,
  ReclaimResult,
  RestartResult,
  ServerStateSnapshot,
} from "../../olt/scripts/src/server/index.ts";

describe("CLI server-ops subsystem", () => {
  describe("server:status command", () => {
    it("runs server:status with default ports and produces structured results", async () => {
      const result = await serverStatusCommand({});
      expect(result).toBeDefined();
      expect(typeof result["markdown"]).toBe("string");
      expect(Array.isArray(result["target_ports"])).toBe(true);
      expect((result["target_ports"] as number[]).length).toBe(DEFAULT_DEV_PORTS.length);
      expect(typeof result["total_scanned"]).toBe("number");
      expect(typeof result["total_occupied"]).toBe("number");
      expect(typeof result["total_processes"]).toBe("number");
      expect(typeof result["total_docker_conflicts"]).toBe("number");
      expect(typeof result["all_available"]).toBe("boolean");
      expect(Array.isArray(result["ports"])).toBe(true);

      const ports = result["ports"] as ServerPortStatus[];
      expect(ports.length).toBe(DEFAULT_DEV_PORTS.length);
      const first = ports[0];
      if (first !== undefined) {
        expect(typeof first.port).toBe("number");
        expect(typeof first.inUse).toBe("boolean");
        expect(typeof first.available).toBe("boolean");
        expect(typeof first.tcpStatus).toBe("string");
        expect(typeof first.socketStatus).toBe("string");
        expect(typeof first.latencyMs).toBe("number");
        expect(Array.isArray(first.pids)).toBe(true);
        expect(Array.isArray(first.processes)).toBe(true);
        expect(Array.isArray(first.dockerConflicts)).toBe(true);
      }
    });

    it("runs server:status with explicit --port flag", async () => {
      const result = await serverStatusCommand({ port: "5173" });
      expect(result).toBeDefined();
      expect(result["target_ports"]).toEqual([5173]);
      expect(result["total_scanned"]).toBe(1);

      const ports = result["ports"] as ServerPortStatus[];
      expect(ports.length).toBe(1);
      const firstPort = ports[0];
      if (firstPort !== undefined) {
        expect(firstPort.port).toBe(5173);
      }
      expect(typeof result["markdown"]).toBe("string");
      expect((result["markdown"] as string).includes("5173")).toBe(true);
    });

    it("runs server:status with --all flag", async () => {
      const result = await serverStatusCommand({ all: true });
      expect(result).toBeDefined();
      expect(result["target_ports"]).toEqual(DEFAULT_DEV_PORTS);
      expect(result["total_scanned"]).toBe(DEFAULT_DEV_PORTS.length);
    });

    it("throws HarnessError on invalid port value", async () => {
      expect(serverStatusCommand({ port: "999999" })).rejects.toThrow();
      expect(serverStatusCommand({ port: "0" })).rejects.toThrow();
      expect(serverStatusCommand({ port: "-5" })).rejects.toThrow();
    });

    it("formatServerStatusMarkdown produces rich markdown table with icons and details", () => {
      const mockProcesses: ProcessDetails[] = [
        {
          pid: 12345,
          ppid: 1,
          name: "node",
          command: "/usr/local/bin/node server.js",
          memoryBytes: 52428800,
          startTime: "Mon Aug 31 05:00:00 2026",
          isZombie: false,
          isOrphaned: true,
          isRuntimeProcess: true,
        },
      ];

      const mockStatuses: ServerPortStatus[] = [
        {
          port: 3000,
          inUse: true,
          available: false,
          tcpStatus: "listening",
          socketStatus: "occupied",
          latencyMs: 4,
          pids: [12345],
          processes: mockProcesses,
          dockerConflicts: [],
        },
        {
          port: 5173,
          inUse: false,
          available: true,
          tcpStatus: "free",
          socketStatus: "available",
          latencyMs: 1,
          pids: [],
          processes: [],
          dockerConflicts: [],
        },
      ];

      const md = formatServerStatusMarkdown(mockStatuses, [3000, 5173]);
      expect(md).toContain("### Dev Server Status Report");
      expect(md).toContain("Scanned Ports");
      expect(md).toContain("Occupied Ports**: 1 / 2");
      expect(md).toContain("Active Server Processes**: 1");
      expect(md).toContain("`3000`");
      expect(md).toContain("`5173`");
      expect(md).toContain("🔴 listening");
      expect(md).toContain("🟢 free");
      expect(md).toContain("node");
      expect(md).toContain("50.0 MB");
    });
  });

  describe("server:restart command", () => {
    it("runs server:restart in --dry-run mode without terminating active processes", async () => {
      const result = await serverRestartCommand({
        port: "3000",
        "dry-run": true,
        command: "bun run dev",
      });

      expect(result).toBeDefined();
      expect(result["port"]).toBe(3000);
      expect(result["dry_run"]).toBe(true);
      expect(result["success"]).toBe(true);
      expect(result["rolled_back"]).toBe(false);
      expect(typeof result["duration_ms"]).toBe("number");
      expect(typeof result["markdown"]).toBe("string");
      expect((result["markdown"] as string).includes("Dry Run (Simulated)")).toBe(true);
      expect((result["markdown"] as string).includes("Port 3000")).toBe(true);

      const snapshot = result["snapshot"] as ServerStateSnapshot;
      expect(snapshot).toBeDefined();
      expect(snapshot.portConfigurations).toBeDefined();
      const portConfig = snapshot.portConfigurations[0];
      if (portConfig !== undefined) {
        expect(portConfig.port).toBe(3000);
      }
    });

    it("runs server:restart with --force flag", async () => {
      const result = await serverRestartCommand({
        port: "8080",
        "dry-run": true,
        force: true,
      });

      expect(result).toBeDefined();
      expect(result["port"]).toBe(8080);
      expect(result["force"]).toBe(true);
      expect(result["dry_run"]).toBe(true);
      expect(result["success"]).toBe(true);
    });

    it("formatServerRestartMarkdown formats success and rollback briefs", () => {
      const mockSnapshot: ServerStateSnapshot = {
        activeEndpoints: [],
        envVariables: {},
        pidHistory: [1111],
        portConfigurations: [{ port: 3000, isPrimary: true }],
        runFlags: {},
        currentPid: 1111,
        timestamp: new Date().toISOString(),
      };

      const successResult: RestartResult = {
        success: true,
        rolledBack: false,
        oldPid: 1111,
        newPid: 2222,
        durationMs: 340,
        snapshot: mockSnapshot,
      };

      const mdSuccess = formatServerRestartMarkdown(successResult, 3000, false, false);
      expect(mdSuccess).toContain("### Dev Server Restart: Port 3000");
      expect(mdSuccess).toContain("✅ SUCCESS");
      expect(mdSuccess).toContain("Previous PID**: `1111`");
      expect(mdSuccess).toContain("New Server PID**: `2222`");
      expect(mdSuccess).toContain("340ms");

      const failureResult: RestartResult = {
        success: false,
        rolledBack: true,
        oldPid: 1111,
        durationMs: 1200,
        snapshot: mockSnapshot,
        error: "Port acquisition timeout",
      };

      const mdFailure = formatServerRestartMarkdown(failureResult, 3000, false, false);
      expect(mdFailure).toContain("❌ FAILED");
      expect(mdFailure).toContain("⚠️ Yes (Rolled back to initial state)");
      expect(mdFailure).toContain("Port acquisition timeout");
    });
  });

  describe("server:clean command", () => {
    it("runs server:clean in --dry-run mode for a specific port", async () => {
      const result = await serverCleanCommand({
        port: "3000",
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["target_ports"]).toEqual([3000]);
      expect(result["dry_run"]).toBe(true);
      expect(typeof result["reclaimed_count"]).toBe("number");
      expect(typeof result["total_attempted"]).toBe("number");
      expect(typeof result["markdown"]).toBe("string");
      expect((result["markdown"] as string).includes("Dry Run (Simulated)")).toBe(true);
      expect(Array.isArray(result["results"])).toBe(true);
    });

    it("runs server:clean with --all and --force flags", async () => {
      const result = await serverCleanCommand({
        all: true,
        force: true,
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["target_ports"]).toEqual(DEFAULT_DEV_PORTS);
      expect(result["force"]).toBe(true);
      expect(result["dry_run"]).toBe(true);
      expect(typeof result["reclaimed_count"]).toBe("number");
    });

    it("runs server:clean with --zombies-only flag", async () => {
      const result = await serverCleanCommand({
        port: "5173",
        "zombies-only": true,
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["zombies_only"]).toBe(true);
      expect(result["target_ports"]).toEqual([5173]);
      expect(Array.isArray(result["results"])).toBe(true);
    });

    it("formatServerCleanMarkdown creates clean formatted markdown table", () => {
      const mockResults: ReclaimResult[] = [
        {
          pid: 9999,
          name: "node",
          port: 3000,
          reclaimed: true,
          signalSent: "SIGTERM",
          durationMs: 45,
        },
        {
          pid: 8888,
          name: "bun",
          port: 5173,
          reclaimed: true,
          signalSent: "SIGKILL",
          durationMs: 120,
        },
      ];

      const md = formatServerCleanMarkdown(mockResults, [3000, 5173], false, false);
      expect(md).toContain("### Dev Server Port Cleanup Summary");
      expect(md).toContain("Reclaimed Processes**: 2 / 2");
      expect(md).toContain("`3000`");
      expect(md).toContain("`5173`");
      expect(md).toContain("`9999`");
      expect(md).toContain("`8888`");
      expect(md).toContain("`SIGTERM`");
      expect(md).toContain("`SIGKILL`");
      expect(md).toContain("🟢 Yes");
    });
  });

  describe("SERVER_COMMANDS registry specification", () => {
    it("registers server:status, server:restart, and server:clean", () => {
      const names = SERVER_COMMANDS.map((c) => c.name);
      expect(names).toContain("server:status");
      expect(names).toContain("server:restart");
      expect(names).toContain("server:clean");
      expect(SERVER_COMMANDS.length).toBe(3);
    });

    it("verifies command metadata, aliases, flags, and exit codes", () => {
      const statusCmd = SERVER_COMMANDS.find((c) => c.name === "server:status");
      expect(statusCmd).toBeDefined();
      if (statusCmd !== undefined) {
        expect(statusCmd.aliases).toContain("status:server");
        expect(statusCmd.domain).toBe("diagnostics");
        expect(statusCmd.flags.some((f) => f.name === "port")).toBe(true);
        expect(statusCmd.flags.some((f) => f.name === "all")).toBe(true);
        expect(statusCmd.flags.some((f) => f.name === "host")).toBe(true);
        expect(statusCmd.flags.some((f) => f.name === "format")).toBe(true);
      }

      const restartCmd = SERVER_COMMANDS.find((c) => c.name === "server:restart");
      expect(restartCmd).toBeDefined();
      if (restartCmd !== undefined) {
        expect(restartCmd.aliases).toContain("restart:server");
        expect(restartCmd.domain).toBe("run");
        expect(restartCmd.flags.some((f) => f.name === "port")).toBe(true);
        expect(restartCmd.flags.some((f) => f.name === "force")).toBe(true);
        expect(restartCmd.flags.some((f) => f.name === "dry-run")).toBe(true);
        expect(restartCmd.flags.some((f) => f.name === "command")).toBe(true);
      }

      const cleanCmd = SERVER_COMMANDS.find((c) => c.name === "server:clean");
      expect(cleanCmd).toBeDefined();
      if (cleanCmd !== undefined) {
        expect(cleanCmd.aliases).toContain("clean:server");
        expect(cleanCmd.aliases).toContain("clean:ports");
        expect(cleanCmd.domain).toBe("run");
        expect(cleanCmd.flags.some((f) => f.name === "port")).toBe(true);
        expect(cleanCmd.flags.some((f) => f.name === "all")).toBe(true);
        expect(cleanCmd.flags.some((f) => f.name === "force")).toBe(true);
        expect(cleanCmd.flags.some((f) => f.name === "dry-run")).toBe(true);
      }
    });

    it("invokes handlers through CommandSpec handler interface", async () => {
      const statusCmd = SERVER_COMMANDS.find((c) => c.name === "server:status");
      expect(statusCmd).toBeDefined();
      if (statusCmd !== undefined) {
        const statusRes = await statusCmd.handler({ port: "3000" }, {}, []);
        expect(statusRes).toBeDefined();
        expect(statusRes["target_ports"]).toEqual([3000]);
      }

      const restartCmd = SERVER_COMMANDS.find((c) => c.name === "server:restart");
      expect(restartCmd).toBeDefined();
      if (restartCmd !== undefined) {
        const restartRes = await restartCmd.handler({ port: "3000", "dry-run": true }, {}, []);
        expect(restartRes).toBeDefined();
        expect(restartRes["dry_run"]).toBe(true);
      }

      const cleanCmd = SERVER_COMMANDS.find((c) => c.name === "server:clean");
      expect(cleanCmd).toBeDefined();
      if (cleanCmd !== undefined) {
        const cleanRes = await cleanCmd.handler({ port: "3000", "dry-run": true }, {}, []);
        expect(cleanRes).toBeDefined();
        expect(cleanRes["dry_run"]).toBe(true);
      }
    });
  });
});
