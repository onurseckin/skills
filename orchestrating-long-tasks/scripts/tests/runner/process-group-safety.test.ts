import { describe, expect, test } from "bun:test";
import { parseDarwinProcessIdentity } from "../../src/runner/darwin-process-identity.ts";
import { parseLinuxProcessIdentity } from "../../src/runner/linux-pipes.ts";
import {
  signalProcessGroup,
  terminateProcessGroup,
  type ProcessGroupIdentity,
} from "../../src/runner/process-group.ts";

describe("process-group identity safety", () => {
  test("uses microsecond or kernel-tick birth identity rather than display timestamps", () => {
    const darwin = Buffer.alloc(136);
    darwin.writeUInt32LE(40, 12);
    darwin.writeUInt32LE(30, 16);
    darwin.writeUInt32LE(40, 100);
    darwin.writeBigUInt64LE(1_000n, 120);
    darwin.writeBigUInt64LE(123_456n, 128);
    expect(parseDarwinProcessIdentity(darwin, 40)?.birth).toBe("1000:123456");

    const fields = ["S", "30", "40", ...Array(16).fill("0"), "987654"];
    expect(
      parseLinuxProcessIdentity(`40 (name with ) parens) ${fields.join(" ")}`, 40)?.birth,
    ).toBe("987654");
  });

  test("uses the validated group id only while the root identity remains live", async () => {
    const expected: ProcessGroupIdentity = { pid: 40, group: 40, birth: "root-birth" };
    let inspections = 0;
    const killed: Array<[number, NodeJS.Signals]> = [];
    const signals = await terminateProcessGroup(40, 0, Promise.resolve(0), expected, {
      inspect: () => (inspections++ === 0 ? expected : undefined),
      kill: (pid, signal) => {
        killed.push([pid, signal]);
        return true;
      },
      wait: async () => undefined,
    });
    expect(killed).toEqual([[-40, "SIGTERM"]]);
    expect(signals).toEqual(["SIGTERM"]);
  });

  test("signals only while the original root remains its own group leader", async () => {
    const expected: ProcessGroupIdentity = { pid: 40, group: 40, birth: "root-birth" };
    const killed: number[] = [];
    await terminateProcessGroup(40, 0, Promise.resolve(0), expected, {
      inspect: () => ({ pid: 40, group: 30, birth: "root-birth" }),
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
      wait: async () => undefined,
    });
    expect(killed).toEqual([]);

    await terminateProcessGroup(40, 0, Promise.resolve(0), expected, {
      inspect: () => ({ pid: 40, group: 40, birth: "reused" }),
      kill: (pid) => {
        killed.push(pid);
        return true;
      },
      wait: async () => undefined,
    });
    expect(killed).toEqual([]);
  });

  test("bounds the no-signal wait when identity inspection fails closed", async () => {
    let waited = false;
    const signals = await terminateProcessGroup(40, 10, new Promise(() => undefined), undefined, {
      inspect: () => undefined,
      kill: () => {
        throw new Error("must not signal");
      },
      wait: async () => {
        waited = true;
      },
    });
    expect(signals).toEqual([]);
    expect(waited).toBeTrue();
  });

  test("rejects unsafe raw process-group identifiers", () => {
    expect(() => signalProcessGroup(0, "SIGTERM", () => true)).toThrow(/identifier|group/i);
    expect(() => signalProcessGroup(1, "SIGTERM", () => true)).toThrow(/identifier|group/i);
  });
});
