import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
  formatServerCleanMarkdown,
  serverCleanCommand,
} from "../../../../../olt/scripts/src/cli/commands/server-ops.ts";
import { SERVER_COMMANDS } from "../../../../../olt/scripts/src/cli/registry/server.ts";
import type { ReclaimResult } from "../../../../../olt/scripts/src/server/index.ts";
import {
  cleanupVirtualNetwork,
  cleanupVirtualServerFS,
  setupVirtualNetwork,
  setupVirtualServerFS,
} from "../../../../server/fixture.ts";

describe("CLI server-ops subsystem - clean & registry", () => {
  let spawnSpy: ReturnType<typeof spyOn> | null = null;
  beforeEach(() => {
    setupVirtualServerFS();
    setupVirtualNetwork();
    spawnSpy = spyOn(childProcess, "spawn").mockImplementation((() => {
      const emitter = new EventEmitter();
      (emitter as unknown as Record<string, unknown>).stdout = new EventEmitter();
      (emitter as unknown as Record<string, unknown>).stderr = new EventEmitter();
      queueMicrotask(() => {
        emitter.emit("close", 0);
      });
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
  describe("server:clean command", () => {
    it("runs server:clean in --dry-run mode for a specific port", async () => {
      const result = await serverCleanCommand({
        port: "3000",
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["dry_run"]).toBe(true);
      expect(result["target_ports"]).toEqual([3000]);
      expect(typeof result["markdown"]).toBe("string");
      expect((result["markdown"] as string).includes("Dry Run (Simulated)")).toBe(true);
    });

    it("runs server:clean with --all and --force flags", async () => {
      const result = await serverCleanCommand({
        all: true,
        force: true,
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["force"]).toBe(true);
      expect(result["dry_run"]).toBe(true);
      expect(Array.isArray(result["target_ports"])).toBe(true);
    });

    it("runs server:clean with --zombies-only flag", async () => {
      const result = await serverCleanCommand({
        "zombies-only": true,
        "dry-run": true,
      });

      expect(result).toBeDefined();
      expect(result["zombies_only"]).toBe(true);
      expect(result["dry_run"]).toBe(true);
    });

    it("formatServerCleanMarkdown creates clean formatted markdown table", () => {
      const mockResults: ReclaimResult[] = [
        {
          port: 3000,
          pid: 100,
          name: "node",
          command: "node server.js",
          reclaimed: true,
          signalSent: "SIGTERM",
          durationMs: 15,
        },
      ];

      const md = formatServerCleanMarkdown(mockResults, [3000], false, false);
      expect(md).toContain("### Dev Server Port Cleanup Summary");
      expect(md).toContain("Target Ports**: `3000`");
      expect(md).toContain("node");
    });
  });

  describe("SERVER_COMMANDS registry specification", () => {
    it("registers server:status, server:restart, and server:clean", () => {
      expect(SERVER_COMMANDS).toBeDefined();
      expect(SERVER_COMMANDS.length).toBe(3);

      const names = SERVER_COMMANDS.map((c) => c.name);
      expect(names).toContain("server:status");
      expect(names).toContain("server:restart");
      expect(names).toContain("server:clean");
    });

    it("verifies command metadata, aliases, flags, and exit codes", () => {
      const statusSpec = SERVER_COMMANDS.find((c) => c.name === "server:status");
      expect(statusSpec).toBeDefined();
      expect(statusSpec?.aliases).toContain("status:server");
      expect(statusSpec?.flags.some((f) => f.name === "port")).toBe(true);
      expect(statusSpec?.flags.some((f) => f.name === "all")).toBe(true);
      expect(statusSpec?.domain).toBe("diagnostics");

      const restartSpec = SERVER_COMMANDS.find((c) => c.name === "server:restart");
      expect(restartSpec).toBeDefined();
      expect(restartSpec?.flags.some((f) => f.name === "port")).toBe(true);
      expect(restartSpec?.flags.some((f) => f.name === "dry-run")).toBe(true);

      const cleanSpec = SERVER_COMMANDS.find((c) => c.name === "server:clean");
      expect(cleanSpec).toBeDefined();
      expect(cleanSpec?.aliases).toContain("clean:server");
      expect(cleanSpec?.flags.some((f) => f.name === "zombies-only")).toBe(true);
    });

    it("invokes handlers through CommandSpec handler interface", async () => {
      const statusSpec = SERVER_COMMANDS.find((c) => c.name === "server:status");
      expect(statusSpec).toBeDefined();
      if (statusSpec !== undefined) {
        const res = await statusSpec.handler({ port: "3000" });
        expect(res).toBeDefined();
        expect(res["target_ports"]).toEqual([3000]);
      }
    });
  });
});
