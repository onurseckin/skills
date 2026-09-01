import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import {
  checkPortAvailability,
  detectInterfaceConflicts,
  detectSocketConflict,
  findAvailablePort,
  inspectComprehensivePort,
  probePorts,
  type ComprehensivePortStatus,
  type SocketConflictResult,
} from "../../../olt/scripts/src/server/probe/index.ts";
import { setupVirtualNetwork, cleanupVirtualNetwork } from "../fixture.ts";

describe("TCP Port Probe Subsystem - Socket Conflicts & Batch Search", () => {
  const ipv4Port = 49152;

  beforeEach(() => {
    setupVirtualNetwork([
      { port: ipv4Port, host: "127.0.0.1" },
      { port: ipv4Port, host: "0.0.0.0" },
      { port: ipv4Port, host: "::1" },
      { port: ipv4Port, host: "::" },
    ]);
  });

  afterEach(() => {
    cleanupVirtualNetwork();
  });

  describe("Batch Probing (probePorts)", () => {
    test("probes multiple ports concurrently with batched concurrency", async () => {
      const testPorts = [ipv4Port, 59872, 59873, 59874];
      const results = await probePorts(testPorts, { concurrency: 2, timeoutMs: 150 });

      expect(results.length).toBe(4);
      const first = results[0];
      if (first !== undefined) {
        expect(first.port).toBe(ipv4Port);
        expect(first.inUse).toBe(true);
      }
      const second = results[1];
      if (second !== undefined) {
        expect(second.port).toBe(59872);
        expect(second.inUse).toBe(false);
      }
      const third = results[2];
      if (third !== undefined) {
        expect(third.port).toBe(59873);
        expect(third.inUse).toBe(false);
      }
    });
  });

  describe("Socket Conflict Detector (detectSocketConflict)", () => {
    test("identifies socket binding conflict (EADDRINUSE) on occupied port", async () => {
      const conflict: SocketConflictResult = await detectSocketConflict(ipv4Port, {
        host: "127.0.0.1",
      });

      expect(conflict.port).toBe(ipv4Port);
      expect(conflict.address).toBe("127.0.0.1");
      expect(conflict.family).toBe("IPv4");
      expect(conflict.status).toBe("occupied");
      expect(conflict.inUse).toBe(true);
      expect(conflict.available).toBe(false);
      if (conflict.error !== undefined) {
        expect(conflict.error.includes("EADDRINUSE")).toBe(true);
      }

      const available = await checkPortAvailability(ipv4Port, "127.0.0.1");
      expect(available).toBe(false);
    });

    test("detects available socket binding on free port", async () => {
      const freePort = 59875;
      const conflict = await detectSocketConflict(freePort, { host: "127.0.0.1" });

      expect(conflict.port).toBe(freePort);
      expect(conflict.status).toBe("available");
      expect(conflict.inUse).toBe(false);
      expect(conflict.available).toBe(true);
      expect(conflict.error).toBeUndefined();

      const available = await checkPortAvailability(freePort, "127.0.0.1");
      expect(available).toBe(true);
    });

    test("detectInterfaceConflicts checks multiple network interfaces", async () => {
      const results = await detectInterfaceConflicts(ipv4Port);
      expect(results.length).toBe(4);
      const ipv4Loopback = results.find((r) => r.address === "127.0.0.1");
      expect(ipv4Loopback !== undefined).toBe(true);
      if (ipv4Loopback !== undefined) {
        expect(ipv4Loopback.inUse).toBe(true);
        expect(ipv4Loopback.available).toBe(false);
      }
    });
  });

  describe("Port Selection (findAvailablePort)", () => {
    test("finds an available port in a given range", async () => {
      const port = await findAvailablePort(59880, 59900);
      expect(port).toBeGreaterThanOrEqual(59880);
      expect(port).toBeLessThanOrEqual(59900);

      const available = await checkPortAvailability(port);
      expect(available).toBe(true);
    });

    test("throws RangeError if startPort is greater than endPort", async () => {
      expect(findAvailablePort(4000, 3000)).rejects.toThrow(RangeError);
    });
  });

  describe("Comprehensive Port Status (inspectComprehensivePort)", () => {
    test("returns combined probe and conflict diagnostic status", async () => {
      const status: ComprehensivePortStatus = await inspectComprehensivePort(ipv4Port);

      expect(status.port).toBe(ipv4Port);
      expect(status.inUse).toBe(true);
      expect(status.available).toBe(false);
      expect(status.probeResults.length).toBe(4);
      expect(status.conflictResults.length).toBe(4);

      const ipv4Probe = status.probeResults.find((r) => r.address === "127.0.0.1");
      expect(ipv4Probe !== undefined).toBe(true);
      if (ipv4Probe !== undefined) {
        expect(ipv4Probe.inUse).toBe(true);
        expect(ipv4Probe.status).toBe("listening");
      }

      const ipv4Conflict = status.conflictResults.find((c) => c.address === "127.0.0.1");
      expect(ipv4Conflict !== undefined).toBe(true);
      if (ipv4Conflict !== undefined) {
        expect(ipv4Conflict.inUse).toBe(true);
        expect(ipv4Conflict.status).toBe("occupied");
      }
    });
  });
});
