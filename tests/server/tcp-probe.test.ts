import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { createServer, type Server } from "node:net";
import {
  checkPortAvailability,
  detectInterfaceConflicts,
  detectSocketConflict,
  findAvailablePort,
  inspectComprehensivePort,
  isIpv6,
  isPortInUse,
  normalizeHost,
  probeAddressFamilies,
  probeAllInterfaces,
  probePorts,
  probeTcpPort,
  resolveFamily,
  validatePort,
  type ComprehensivePortStatus,
  type SocketConflictResult,
  type TcpProbeResult,
} from "../../olt/scripts/src/server/probe/index.ts";

describe("TCP Port Probe & Socket Conflict Detector", () => {
  let ipv4Server: Server | undefined;
  let ipv4Port = 0;
  let ipv6Server: Server | undefined;
  let ipv6Port = 0;

  beforeAll(async () => {
    // Start an active IPv4 test server on an ephemeral port
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr !== null && typeof addr === "object") {
          ipv4Port = addr.port;
          ipv4Server = server;
          resolve();
        } else {
          reject(new Error("Failed to get IPv4 server address"));
        }
      });
      server.once("error", reject);
    });

    // Start an active IPv6 test server on an ephemeral port
    await new Promise<void>((resolve) => {
      const server = createServer();
      server.listen(0, "::1", () => {
        const addr = server.address();
        if (addr !== null && typeof addr === "object") {
          ipv6Port = addr.port;
          ipv6Server = server;
          resolve();
        } else {
          resolve();
        }
      });
      server.once("error", () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => {
        if (ipv4Server !== undefined) {
          ipv4Server.close(() => resolve());
        } else {
          resolve();
        }
      }),
      new Promise<void>((resolve) => {
        if (ipv6Server !== undefined) {
          ipv6Server.close(() => resolve());
        } else {
          resolve();
        }
      }),
    ]);
  });

  describe("Utility & Validation Functions", () => {
    test("validatePort accepts valid ports in 1-65535 range", () => {
      expect(() => validatePort(1)).not.toThrow();
      expect(() => validatePort(80)).not.toThrow();
      expect(() => validatePort(3000)).not.toThrow();
      expect(() => validatePort(8080)).not.toThrow();
      expect(() => validatePort(65535)).not.toThrow();
    });

    test("validatePort rejects out-of-range or non-integer values", () => {
      expect(() => validatePort(0)).toThrow(RangeError);
      expect(() => validatePort(-1)).toThrow(RangeError);
      expect(() => validatePort(65536)).toThrow(RangeError);
      expect(() => validatePort(70000)).toThrow(RangeError);
      expect(() => validatePort(NaN)).toThrow(RangeError);
      expect(() => validatePort(3000.5)).toThrow(RangeError);
    });

    test("normalizeHost returns default host or trimmed host", () => {
      expect(normalizeHost()).toBe("127.0.0.1");
      expect(normalizeHost("")).toBe("127.0.0.1");
      expect(normalizeHost("   ")).toBe("127.0.0.1");
      expect(normalizeHost("localhost")).toBe("localhost");
      expect(normalizeHost(" 0.0.0.0 ")).toBe("0.0.0.0");
      expect(normalizeHost("::1")).toBe("::1");
    });

    test("isIpv6 and resolveFamily accurately distinguish IPv4 and IPv6", () => {
      expect(isIpv6("127.0.0.1")).toBe(false);
      expect(isIpv6("0.0.0.0")).toBe(false);
      expect(isIpv6("192.168.1.1")).toBe(false);
      expect(resolveFamily("127.0.0.1")).toBe("IPv4");
      expect(resolveFamily("0.0.0.0")).toBe("IPv4");

      expect(isIpv6("::1")).toBe(true);
      expect(isIpv6("::")).toBe(true);
      expect(isIpv6("fe80::1")).toBe(true);
      expect(resolveFamily("::1")).toBe("IPv6");
      expect(resolveFamily("::")).toBe("IPv6");
    });
  });

  describe("TCP Port Probing (probeTcpPort & isPortInUse)", () => {
    test("detects active occupied listening port", async () => {
      expect(ipv4Port).toBeGreaterThan(0);
      const result: TcpProbeResult = await probeTcpPort(ipv4Port, { host: "127.0.0.1" });

      expect(result.port).toBe(ipv4Port);
      expect(result.inUse).toBe(true);
      expect(result.address).toBe("127.0.0.1");
      expect(result.family).toBe("IPv4");
      expect(result.status).toBe("listening");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();

      const inUse = await isPortInUse(ipv4Port, "127.0.0.1");
      expect(inUse).toBe(true);
    });

    test("detects free/closed port with connection refusal", async () => {
      const freePort = 59871;
      const result: TcpProbeResult = await probeTcpPort(freePort, {
        host: "127.0.0.1",
        timeoutMs: 300,
      });

      expect(result.port).toBe(freePort);
      expect(result.inUse).toBe(false);
      expect(result.address).toBe("127.0.0.1");
      expect(result.family).toBe("IPv4");
      expect(result.status).toBe("refused");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      const inUse = await isPortInUse(freePort, "127.0.0.1");
      expect(inUse).toBe(false);
    });

    test("handles timeout resilience on non-responsive target", async () => {
      const result = await probeTcpPort(80, {
        host: "198.51.100.1",
        timeoutMs: 50,
      });

      expect(result.inUse).toBe(false);
      expect(result.status).toBe("timeout");
      expect(result.error !== undefined).toBe(true);
    });

    test("probes IPv6 socket when active", async () => {
      if (ipv6Port > 0) {
        const result = await probeTcpPort(ipv6Port, { host: "::1" });
        expect(result.port).toBe(ipv6Port);
        expect(result.family).toBe("IPv6");
        expect(result.inUse).toBe(true);
        expect(result.status).toBe("listening");
      }
    });

    test("probeAddressFamilies probes both IPv4 and IPv6 concurrently", async () => {
      const { ipv4, ipv6 } = await probeAddressFamilies(ipv4Port);
      expect(ipv4.port).toBe(ipv4Port);
      expect(ipv4.family).toBe("IPv4");
      expect(ipv4.inUse).toBe(true);

      expect(ipv6.port).toBe(ipv4Port);
      expect(ipv6.family).toBe("IPv6");
    });

    test("probeAllInterfaces probes common loopback and bind interfaces", async () => {
      const results = await probeAllInterfaces(ipv4Port, { timeoutMs: 150 });
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.inUse)).toBe(true);
    });
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
