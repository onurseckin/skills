import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as net from "node:net";
import {
  DEFAULT_BIND_POLL_INTERVAL_MS,
  DEFAULT_BIND_TIMEOUT_MS,
  checkTcpPort,
  startServer,
} from "../../olt/scripts/src/server/lifecycle/starter.ts";
import * as shutdownModule from "../../olt/scripts/src/server/lifecycle/shutdown.ts";

describe("Dev Server Starter & Port Acquisition Verifier Subsystem", () => {
  const spies: Array<{ mockRestore: () => void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("exports default bind constants", () => {
    expect(DEFAULT_BIND_TIMEOUT_MS).toBe(5000);
    expect(DEFAULT_BIND_POLL_INTERVAL_MS).toBe(100);
  });

  describe("checkTcpPort", () => {
    it("returns true when TCP port is active and listening", async () => {
      const server = net.createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address() as net.AddressInfo;
      const port = address.port;

      const isOpen = await checkTcpPort(port, "127.0.0.1");
      expect(isOpen).toBe(true);

      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("returns false when TCP port is closed or invalid", async () => {
      // Pick a random unlikely port
      const isOpen = await checkTcpPort(59999);
      expect(isOpen).toBe(false);
    });

    it("handles host normalization (null, empty, custom)", async () => {
      const isNullHost = await checkTcpPort(59998, null as unknown as string);
      expect(isNullHost).toBe(false);

      const isEmptyHost = await checkTcpPort(59998, "");
      expect(isEmptyHost).toBe(false);

      const isCustomHost = await checkTcpPort(59998, "localhost");
      expect(isCustomHost).toBe(false);
    });

    it("handles socket timeout and error events safely", async () => {
      // 1. Timeout simulation
      const spyTimeout = spyOn(net.Socket.prototype, "connect").mockImplementation(
        function (this: net.Socket) {
          process.nextTick(() => this.emit("timeout"));
          return this;
        },
      );
      spies.push(spyTimeout);

      const resTimeout = await checkTcpPort(8080);
      expect(resTimeout).toBe(false);
      spyTimeout.mockRestore();

      // 2. Error simulation
      const spyError = spyOn(net.Socket.prototype, "connect").mockImplementation(
        function (this: net.Socket) {
          process.nextTick(() => this.emit("error", new Error("connection reset")));
          return this;
        },
      );
      spies.push(spyError);

      const resError = await checkTcpPort(8080);
      expect(resError).toBe(false);
    });
  });

  describe("startServer", () => {
    it("immediately succeeds when no target ports are configured", async () => {
      const result = await startServer({
        spawnServerFn: async () => ({ pid: 12345 }),
      });

      expect(result.started).toBe(true);
      expect(result.pid).toBe(12345);
      expect(result.boundPorts).toEqual([]);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("verifies port binding across portConfigurations and dedupes ports", async () => {
      let pollCount = 0;
      const result = await startServer({
        primaryPort: 3000,
        portConfigurations: [
          { port: 3000, protocol: "tcp", isPrimary: true },
          { port: 3000, protocol: "tcp", isPrimary: true }, // duplicate
          { port: 3001, protocol: "tcp", isPrimary: false },
        ],
        spawnServerFn: async () => ({ pid: 999 }),
        portChecker: async (port) => {
          pollCount++;
          return port === 3000 || pollCount > 2;
        },
        sleepFn: async () => {},
        bindTimeoutMs: 1000,
        bindPollIntervalMs: 10,
      });

      expect(result.started).toBe(true);
      expect(result.pid).toBe(999);
      expect(result.boundPorts.sort()).toEqual([3000, 3001]);
    });

    it("falls back to primaryPort when portConfigurations is omitted", async () => {
      const result = await startServer({
        primaryPort: 4000,
        spawnServerFn: async () => ({ pid: 888 }),
        portChecker: async () => true,
        sleepFn: async () => {},
      });

      expect(result.started).toBe(true);
      expect(result.boundPorts).toEqual([4000]);
    });

    it("handles spawn failure with Error object or non-Error throw", async () => {
      const resError = await startServer({
        spawnServerFn: async () => {
          throw new Error("spawn failed with ENOENT");
        },
      });

      expect(resError.started).toBe(false);
      expect(resError.pid).toBe(0);
      expect(resError.error).toContain("spawn failed with ENOENT");

      const resString = await startServer({
        spawnServerFn: async () => {
          throw "raw string failure";
        },
      });

      expect(resString.started).toBe(false);
      expect(resString.pid).toBe(0);
      expect(resString.error).toContain("raw string failure");
    });

    it("handles bind timeout, invokes process shutdown, and ignores shutdown failure", async () => {
      let shutdownCalled = false;
      spies.push(
        spyOn(shutdownModule, "shutdownProcess").mockImplementation(async () => {
          shutdownCalled = true;
          throw new Error("shutdown failure ignored");
        }),
      );

      const result = await startServer({
        primaryPort: 5000,
        spawnServerFn: async () => ({ pid: 777 }),
        portChecker: async () => false,
        sleepFn: async () => {},
        bindTimeoutMs: 50,
        bindPollIntervalMs: 10,
      });

      expect(result.started).toBe(false);
      expect(result.pid).toBe(777);
      expect(shutdownCalled).toBe(true);
      expect(result.error).toContain("Dev server failed to bind target ports [5000] within 50ms.");
    });

    it("exercises defaultSpawn and defaultSleep branches", async () => {
      const mockChild = {
        pid: 65432,
        unref: () => {},
      };

      const spawnSpy = spyOn(childProcess, "spawn").mockReturnValue(
        mockChild as unknown as childProcess.ChildProcess,
      );
      spies.push(spawnSpy);

      // 1. Successful spawn with custom options
      const resCustom = await startServer({
        command: "node",
        args: ["server.js"],
        cwd: "/tmp",
        env: { PORT: "9000" },
        primaryPort: 9000,
        portChecker: async () => true,
        sleepFn: async () => {},
      });

      expect(resCustom.started).toBe(true);
      expect(resCustom.pid).toBe(65432);
      expect(spawnSpy).toHaveBeenCalledWith(
        "node",
        ["server.js"],
        expect.objectContaining({ cwd: "/tmp" }),
      );

      // 2. Default spawn arguments when options are minimal
      const resDefaults = await startServer({
        portChecker: async () => true,
        primaryPort: 3000,
        sleepFn: async () => {},
      });
      expect(resDefaults.started).toBe(true);
      expect(spawnSpy).toHaveBeenCalledWith("bun", ["run", "dev"], expect.anything());

      // 3. Spawner error when child.pid is undefined
      spawnSpy.mockReturnValue({
        pid: undefined,
        unref: () => {},
      } as unknown as childProcess.ChildProcess);
      const resNoPid = await startServer({});
      expect(resNoPid.started).toBe(false);
      expect(resNoPid.error).toContain("Failed to spawn server process");

      // 4. Spawner error when child.pid <= 0
      spawnSpy.mockReturnValue({ pid: 0, unref: () => {} } as unknown as childProcess.ChildProcess);
      const resZeroPid = await startServer({});
      expect(resZeroPid.started).toBe(false);
      expect(resZeroPid.error).toContain("Invalid process PID spawned");

      // 5. Default sleep execution on real timer loop
      spawnSpy.mockReturnValue(mockChild as unknown as childProcess.ChildProcess);
      let attempts = 0;
      const resRealSleep = await startServer({
        primaryPort: 9001,
        bindTimeoutMs: 500,
        bindPollIntervalMs: 5,
        portChecker: async () => {
          attempts++;
          return attempts >= 2;
        },
      });
      expect(resRealSleep.started).toBe(true);
    });
  });
});
