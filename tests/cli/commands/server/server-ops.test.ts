import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
  DEFAULT_DEV_PORTS,
  formatServerCleanMarkdown,
  formatServerRestartMarkdown,
  formatServerStatusMarkdown,
  serverCleanCommand,
  serverRestartCommand,
  serverStatusCommand,
  type ServerPortStatus,
} from "../../../../olt/scripts/src/cli/commands/server-ops.ts";
import * as serverIndex from "../../../../olt/scripts/src/server/index.ts";
import type {
  ProcessDetails,
  ReclaimResult,
  RestartResult,
  ServerStateSnapshot,
} from "../../../../olt/scripts/src/server/index.ts";
import {
  cleanupVirtualNetwork,
  cleanupVirtualServerFS,
  setupVirtualNetwork,
  setupVirtualServerFS,
} from "../../../server/fixture.ts";

describe("server-ops CLI command coverage suite", () => {
  let spawnSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    setupVirtualServerFS();
    setupVirtualNetwork([{ port: 3000, host: "127.0.0.1" }]);
    spawnSpy = spyOn(childProcess, "spawn").mockImplementation((() => {
      const emitter = new EventEmitter();
      (emitter as unknown as Record<string, unknown>).stdout = new EventEmitter();
      (emitter as unknown as Record<string, unknown>).stderr = new EventEmitter();
      queueMicrotask(() => emitter.emit("close", 0));
      return emitter as unknown as childProcess.ChildProcess;
    }) as never);
  });

  afterEach(() => {
    if (spawnSpy) {
      spawnSpy.mockRestore();
      spawnSpy = null;
    }
    cleanupVirtualNetwork();
    cleanupVirtualServerFS();
  });

  test("formatServerStatusMarkdown renders empty state and rich table with badges", () => {
    expect(formatServerStatusMarkdown([], [])).toContain("| — | — | — | — | — | — | — |");

    const mockProc: ProcessDetails = {
      pid: 4500,
      ppid: 1,
      name: "node-server",
      command: "/usr/local/bin/very-long-server-binary-execution-path --flag=1",
      memoryBytes: 104857600,
      startTime: "Tue Sep 01 2026",
      isZombie: true,
      isOrphaned: true,
      isRuntimeProcess: true,
    };

    const statuses: ServerPortStatus[] = [
      {
        port: 3000,
        inUse: true,
        available: false,
        tcpStatus: "listening",
        socketStatus: "occupied",
        latencyMs: 12,
        pids: [4500],
        processes: [mockProc],
        dockerConflicts: [
          {
            containerId: "c1",
            containerName: "web-app",
            image: "node:20",
            hostPort: 3000,
            containerPort: 80,
          },
        ],
        error: "First error",
      },
      {
        port: 5000,
        inUse: false,
        available: true,
        tcpStatus: "free",
        socketStatus: "available",
        latencyMs: 1,
        pids: [],
        processes: [],
        dockerConflicts: [],
      },
      {
        port: 6000,
        inUse: false,
        available: false,
        tcpStatus: "custom_status",
        socketStatus: "error",
        latencyMs: 0,
        pids: [],
        processes: [],
        dockerConflicts: [],
        error: "Probe error",
      },
    ];

    const md = formatServerStatusMarkdown(statuses, [3000, 5000, 6000]);
    expect(md).toContain("🔴 listening");
    expect(md).toContain("🟢 free");
    expect(md).toContain("⚪ custom_status");
    expect(md).toContain("*(zombie)*");
    expect(md).toContain("*(orphan)*");
    expect(md).toContain("100.0 MB");
    expect(md).toContain("`web-app` (node:20) -> :80");
  });

  test("formatServerRestartMarkdown renders success, force, rollback, and error formats", () => {
    const mockSnapshot: ServerStateSnapshot = {
      activeEndpoints: [],
      envVariables: {},
      pidHistory: [100],
      portConfigurations: [{ port: 3000, isPrimary: true }],
      runFlags: {},
      currentPid: 100,
      timestamp: new Date().toISOString(),
    };

    const res1: RestartResult = {
      success: true,
      rolledBack: false,
      oldPid: 100,
      newPid: 200,
      durationMs: 45,
      snapshot: mockSnapshot,
    };
    const md1 = formatServerRestartMarkdown(res1, 3000, false, true);
    expect(md1).toContain("✅ SUCCESS");
    expect(md1).toContain("Force Restart");
    expect(md1).toContain("✅ Captured");

    const res2: RestartResult = {
      success: false,
      rolledBack: true,
      durationMs: 120,
      error: "Port binding rejected",
    };
    const md2 = formatServerRestartMarkdown(res2, 3000, false, false);
    expect(md2).toContain("❌ FAILED");
    expect(md2).toContain("Graceful Restart");
    expect(md2).toContain("⚠️ Yes (Rolled back to initial state)");
    expect(md2).toContain("Error**: `Port binding rejected`");
  });

  test("formatServerCleanMarkdown renders empty, force, and dry-run summaries", () => {
    expect(formatServerCleanMarkdown([], [3000], false, false)).toContain(
      "| — | — | — | — | — | — | — |",
    );

    const results: ReclaimResult[] = [
      {
        port: 3000,
        pid: 101,
        name: "dev-server",
        command: "bun run dev",
        reclaimed: true,
        signalSent: "SIGTERM",
        durationMs: 10,
      },
      {
        port: 3001,
        pid: 102,
        name: "worker",
        command: "node worker.js",
        reclaimed: false,
        signalSent: "SIGKILL",
        durationMs: 5,
        error: "Access denied",
      },
    ];
    const md1 = formatServerCleanMarkdown(results, [3000, 3001], true, false);
    expect(md1).toContain("Dry Run (Simulated)");
    expect(md1).toContain("🟢 Yes");
    expect(md1).toContain("⚪ Simulated");

    const md2 = formatServerCleanMarkdown(results, [3000, 3001], false, true);
    expect(md2).toContain("Force Termination (SIGKILL)");
    expect(md2).toContain("🔴 No");
  });

  test("serverStatusCommand handles default, explicit port, all, and probe error", async () => {
    const defRes = await serverStatusCommand({});
    expect(defRes.target_ports).toEqual(DEFAULT_DEV_PORTS);
    expect(defRes.total_scanned).toBe(DEFAULT_DEV_PORTS.length);

    const portRes = await serverStatusCommand({ port: "3000", host: "127.0.0.1" });
    expect(portRes.target_ports).toEqual([3000]);
    expect(portRes.total_scanned).toBe(1);

    const allRes = await serverStatusCommand({ all: true });
    expect(allRes.target_ports).toEqual(DEFAULT_DEV_PORTS);

    const spyProbe = spyOn(serverIndex, "probeTcpPort").mockImplementationOnce(() => {
      throw new Error("Port probe crashed");
    });
    const errRes = await serverStatusCommand({ port: "5555" });
    expect(errRes.total_scanned).toBe(1);
    const ports = errRes.ports as ServerPortStatus[];
    expect(ports[0]?.tcpStatus).toBe("error");
    expect(ports[0]?.error).toBe("Port probe crashed");
    spyProbe.mockRestore();
  });

  test("serverRestartCommand and serverCleanCommand handle options, dry-run, and execution", async () => {
    const spyPids = spyOn(serverIndex, "findPidsOnPort").mockResolvedValueOnce([1234]);
    const res1 = await serverRestartCommand({
      port: "4000",
      "dry-run": true,
      command: "npm start",
      force: true,
    });
    expect(res1.port === 4000 && res1.dry_run === true && res1.old_pid === 1234).toBe(true);
    spyPids.mockRestore();

    const spyLifecycle = spyOn(serverIndex, "createServerLifecycleManager").mockReturnValueOnce({
      getState: () => null,
      captureState: () => ({
        activeEndpoints: [],
        envVariables: {},
        pidHistory: [],
        portConfigurations: [],
        runFlags: {},
        currentPid: undefined,
        timestamp: "",
      }),
      restoreState: () => ({ success: true, rolledBack: false, restoredEndpoints: [], errors: [] }),
      restart: async () => ({
        success: true,
        oldPid: 555,
        newPid: 666,
        durationMs: 25,
        rolledBack: false,
      }),
    } as unknown as serverIndex.DevServerLifecycleManager);

    const res3 = await serverRestartCommand({ port: "9998", force: true, "grace-period-ms": "0" });
    expect(res3.port === 9998 && res3.old_pid === 555 && res3.new_pid === 666).toBe(true);
    spyLifecycle.mockRestore();

    const cleanRes = await serverCleanCommand({
      all: true,
      "zombies-only": true,
      "dry-run": true,
      force: true,
    });
    expect(cleanRes.target_ports).toEqual(DEFAULT_DEV_PORTS);
  });
});
