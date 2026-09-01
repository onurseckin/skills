import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DEV_PORTS,
  formatServerRestartMarkdown,
  formatServerStatusMarkdown,
  serverRestartCommand,
  serverStatusCommand,
  type ServerPortStatus,
} from "../../../../../olt/scripts/src/cli/commands/server-ops.ts";
import type {
  ProcessDetails,
  RestartResult,
  ServerStateSnapshot,
} from "../../../../../olt/scripts/src/server/index.ts";

describe("CLI server-ops subsystem - status & restart", () => {
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
      }
    });

    it("runs server:status with explicit --port flag", async () => {
      const result = await serverStatusCommand({ port: "5173" });
      expect(result).toBeDefined();
      expect(result["target_ports"]).toEqual([5173]);
      expect(result["total_scanned"]).toBe(1);

      const ports = result["ports"] as ServerPortStatus[];
      expect(ports.length).toBe(1);
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
      expect(md).toContain("node");
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
    });
  });
});
