import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { createServer, type Server } from "node:net";
import {
  isIpv6,
  isPortInUse,
  normalizeHost,
  probeAddressFamilies,
  probeAllInterfaces,
  probeTcpPort,
  resolveFamily,
  validatePort,
  type TcpProbeResult,
} from "../../../olt/scripts/src/server/probe/index.ts";

describe("TCP Port Probe Subsystem - Connection & Validation", () => {
  let ipv4Server: Server | undefined;
  let ipv4Port = 0;
  let ipv6Server: Server | undefined;
  let ipv6Port = 0;

  beforeAll(async () => {
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
});
