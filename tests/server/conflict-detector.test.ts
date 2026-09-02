import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import {
  checkPortAvailability,
  detectInterfaceConflicts,
  detectSocketConflict,
  findAvailablePort,
  inspectComprehensivePort,
} from "../../olt/scripts/src/server/probe/conflict-detector.ts";
import { cleanupVirtualNetwork, setupVirtualNetwork } from "./fixture.ts";

describe("conflict-detector coverage suite", () => {
  beforeEach(() => {
    setupVirtualNetwork([{ port: 3000, host: "127.0.0.1" }]);
  });

  afterEach(() => {
    cleanupVirtualNetwork();
  });

  test("validates port numbers and throws RangeError on invalid values", () => {
    expect(() => detectSocketConflict(0)).toThrow(RangeError);
    expect(() => detectSocketConflict(65536)).toThrow(RangeError);
    expect(() => detectSocketConflict(-1)).toThrow(RangeError);
    expect(() => detectSocketConflict(3.14)).toThrow(RangeError);
  });

  test("detectSocketConflict detects occupied and available ports with host options", async () => {
    const occupied = await detectSocketConflict(3000, { host: "127.0.0.1" });
    expect(occupied.status).toBe("occupied");
    expect(occupied.inUse).toBe(true);
    expect(occupied.available).toBe(false);
    expect(occupied.address).toBe("127.0.0.1");
    expect(occupied.family).toBe("IPv4");
    expect(occupied.error).toContain("EADDRINUSE");

    const available = await detectSocketConflict(4000, { host: "::1" });
    expect(available.status).toBe("available");
    expect(available.inUse).toBe(false);
    expect(available.available).toBe(true);
    expect(available.address).toBe("::1");
    expect(available.family).toBe("IPv6");
    expect(available.error).toBeUndefined();
  });

  test("detectSocketConflict maps various socket error codes accurately", async () => {
    cleanupVirtualNetwork();

    const mockErrorWithCode = (code: string, message = ""): void => {
      spyOn(net, "createServer").mockImplementation((() => {
        const emitter = new EventEmitter();
        (emitter as unknown as Record<string, unknown>)["listen"] = () => {
          queueMicrotask(() => {
            const err = Object.assign(new Error(message), { code });
            emitter.emit("error", err);
          });
          return emitter;
        };
        (emitter as unknown as Record<string, unknown>)["removeAllListeners"] = () => emitter;
        return emitter as unknown as net.Server;
      }) as never);
    };

    // 1. EACCES -> blocked
    mockErrorWithCode("EACCES", "Permission denied");
    const blockedRes = await detectSocketConflict(80);
    expect(blockedRes.status).toBe("blocked");
    expect(blockedRes.available).toBe(false);
    expect(blockedRes.error).toContain("EACCES");

    // 2. EADDRNOTAVAIL, EINVAL, EHOSTUNREACH -> available
    for (const code of [
      "EADDRNOTAVAIL",
      "EAFNOSUPPORT",
      "EINVAL",
      "ENOTFOUND",
      "EPROTONOSUPPORT",
      "EHOSTUNREACH",
    ]) {
      mockErrorWithCode(code);
      const ignorable = await detectSocketConflict(5000);
      expect(ignorable.status).toBe("available");
      expect(ignorable.available).toBe(true);
    }

    // 3. Custom error with message
    mockErrorWithCode("ECUSTOM", "Custom connection error");
    const customRes = await detectSocketConflict(6000);
    expect(customRes.status).toBe("error");
    expect(customRes.error).toBe("Custom connection error");

    // 4. Custom error code only without message
    mockErrorWithCode("EUNKNOWN_CODE", "");
    const codeOnlyRes = await detectSocketConflict(6001);
    expect(codeOnlyRes.status).toBe("error");
    expect(codeOnlyRes.error).toBe("EUNKNOWN_CODE");

    // 5. Error with empty message and empty code
    mockErrorWithCode("", "");
    const emptyErrRes = await detectSocketConflict(6002);
    expect(emptyErrRes.status).toBe("error");
    expect(emptyErrRes.error).toBe("Unknown binding error");
  });

  test("detectSocketConflict handles synchronous throw inside server.listen", async () => {
    cleanupVirtualNetwork();
    spyOn(net, "createServer").mockImplementation((() => {
      const emitter = new EventEmitter();
      (emitter as unknown as Record<string, unknown>)["listen"] = () => {
        throw new Error("Synchronous listen failure");
      };
      (emitter as unknown as Record<string, unknown>)["removeAllListeners"] = () => emitter;
      return emitter as unknown as net.Server;
    }) as never);

    const res1 = await detectSocketConflict(7000);
    expect(res1.status).toBe("error");
    expect(res1.inUse).toBe(false);
    expect(res1.available).toBe(false);
    expect(res1.error).toBe("Synchronous listen failure");

    // Non-Error throw (e.g. string)
    spyOn(net, "createServer").mockImplementation((() => {
      const emitter = new EventEmitter();
      (emitter as unknown as Record<string, unknown>)["listen"] = () => {
        throw "String listen failure";
      };
      (emitter as unknown as Record<string, unknown>)["removeAllListeners"] = () => emitter;
      return emitter as unknown as net.Server;
    }) as never);

    const res2 = await detectSocketConflict(7001);
    expect(res2.status).toBe("error");
    expect(res2.error).toBe("String listen failure");
  });

  test("checkPortAvailability returns boolean status", async () => {
    const isAvail = await checkPortAvailability(5050);
    expect(typeof isAvail).toBe("boolean");
    expect(isAvail).toBe(true);

    const isOccupied = await checkPortAvailability(3000, "127.0.0.1");
    expect(isOccupied).toBe(false);
  });

  test("findAvailablePort finds port or throws when out of range or exhausted", async () => {
    await expect(findAvailablePort(5000, 4000)).rejects.toThrow(RangeError);
    expect(() => findAvailablePort(0, 1000)).toThrow(RangeError);

    const port = await findAvailablePort(3001, 3010);
    expect(port).toBe(3001);

    // Exhausted with custom host
    setupVirtualNetwork([
      { port: 9100, host: "127.0.0.1" },
      { port: 9101, host: "127.0.0.1" },
    ]);
    await expect(findAvailablePort(9100, 9101, { host: "127.0.0.1" })).rejects.toThrow(
      "No available ports found in range 9100-9101 on host 127.0.0.1",
    );

    // Exhausted with default host
    await expect(findAvailablePort(9100, 9101)).rejects.toThrow(
      "No available ports found in range 9100-9101 on host 127.0.0.1",
    );
  });

  test("detectInterfaceConflicts scans all common interfaces sequentially", async () => {
    const conflicts = await detectInterfaceConflicts(3000);
    expect(conflicts.length).toBe(4);
    const addresses = conflicts.map((c) => c.address);
    expect(addresses).toContain("127.0.0.1");
    expect(addresses).toContain("0.0.0.0");
    expect(addresses).toContain("::1");
    expect(addresses).toContain("::");
  });

  test("inspectComprehensivePort combines probe and conflict statuses", async () => {
    // 1. Occupied port
    const occStatus = await inspectComprehensivePort(3000);
    expect(occStatus.port).toBe(3000);
    expect(occStatus.inUse).toBe(true);
    expect(occStatus.available).toBe(false);
    expect(occStatus.probeResults.length).toBe(4);
    expect(occStatus.conflictResults.length).toBe(4);

    // 2. Free port
    const freeStatus = await inspectComprehensivePort(9990);
    expect(freeStatus.port).toBe(9990);
    expect(freeStatus.inUse).toBe(false);
    expect(freeStatus.available).toBe(true);
  });
});
