import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  atomicWriteBytes,
  durableAppendBytes,
} from "../../../olt/scripts/src/core/durable-write.ts";
import {
  createDurableFsState,
  createDurableRuntimeSpies,
  populateRuntimeSourceTree,
  type DurableFsState,
} from "./fixtures.ts";

describe("durable runtime files", () => {
  let state: DurableFsState;
  const spies: { mockRestore: () => void }[] = [];
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/virtual-harness-runtime-${++rootCounter}`;
    state.mockDirs.add(root);
    const source = join(root, "source");
    populateRuntimeSourceTree(state, source);
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    state = createDurableFsState();
    spies.push(...createDurableRuntimeSpies(state));
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("test_atomic_write_sets_mode_before_syncing_content", () => {
    const { root } = fixture();
    const steps: string[] = [];
    const target = join(root, "durable");
    atomicWriteBytes(target, new TextEncoder().encode("ok"), {
      mode: 0o440,
      observe: (step) => steps.push(step),
    });
    expect(steps.indexOf("chmod")).toBeLessThan(steps.indexOf("file-fsync"));
    expect(fs.statSync(target).mode & 0o777).toBe(0o440);
  });

  test("durableAppendBytes appends ordered records and syncs the file before its directory", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const steps: string[] = [];

    durableAppendBytes(target, new TextEncoder().encode("first\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("second\n"), {
      observe: (step) => steps.push(step),
    });

    expect(fs.readFileSync(target, "utf8")).toBe("first\nsecond\n");
    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
  });

  test("durableAppendBytes holds its record lock through directory durability and rejects re-entry", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const order: string[] = [];
    let locked = false;
    let nestedRejected = false;
    const bytes = new TextEncoder().encode("outer\n");
    const dependencies = {
      open: fs.openSync,
      write(descriptor: number, value: Uint8Array, offset: number, length: number): number {
        expect(locked).toBeTrue();
        try {
          durableAppendBytes(target, new TextEncoder().encode("inner\n"), {
            timeoutMs: 0,
            dependencies,
          });
        } catch (error) {
          nestedRejected = /already active/i.test(String(error));
        }
        order.push("write");
        return fs.writeSync(descriptor, value, offset, length);
      },
      fsync(descriptor: number): void {
        order.push("file-fsync");
        fs.fsyncSync(descriptor);
      },
      close(descriptor: number): void {
        order.push("close");
        fs.closeSync(descriptor);
      },
      tryExclusiveFlock(): boolean {
        order.push("lock");
        locked = true;
        return true;
      },
      releaseFlock(): void {
        order.push("unlock");
        locked = false;
      },
      fsyncDirectory(): void {
        order.push("directory-fsync");
      },
    };

    durableAppendBytes(target, bytes, { dependencies });

    expect(nestedRejected).toBeTrue();
    expect(fs.readFileSync(target, "utf8")).toBe("outer\n");
    expect(order).toEqual(["lock", "write", "file-fsync", "directory-fsync", "unlock", "close"]);
  });

  test("durableAppendBytes times out rather than interleaving with a held exclusive flock", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
    const target = join(root, "events.jsonl");
    let attempts = 0;
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("blocked\n"), {
        timeoutMs: 25,
        retryMs: 2,
        dependencies: {
          tryExclusiveFlock: () => {
            attempts += 1;
            return false;
          },
        },
      }),
    ).toThrow(/timed out/i);
    expect(attempts).toBeGreaterThan(1);
    expect(fs.existsSync(target)).toBeTrue();
  });

  test("durableAppendBytes keeps every tiny-write JSON record whole across partial writes", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
    const target = join(root, "events.jsonl");
    for (const worker of ["a", "b"]) {
      for (let index = 0; index < 8; index += 1) {
        durableAppendBytes(
          target,
          new TextEncoder().encode(JSON.stringify({ worker, index }) + "\n"),
          {
            timeoutMs: 2_000,
            retryMs: 1,
            dependencies: {
              write(descriptor, data, offset, length) {
                return fs.writeSync(descriptor, data, offset, Math.min(length, 1));
              },
            },
          },
        );
      }
    }

    const records = fs
      .readFileSync(target, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { worker: string; index: number });
    expect(records).toHaveLength(16);
    expect(new Set(records.map((record) => `${record.worker}:${record.index}`)).size).toBe(16);
  });

  test("durableAppendBytes retries partial writes and rejects zero-progress or empty records", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    state.mockDirs.add(root);
    const target = join(root, "events.jsonl");
    const bytes = new TextEncoder().encode("partial\n");
    let writes = 0;
    durableAppendBytes(target, bytes, {
      dependencies: {
        write(descriptor, value, offset, length): number {
          writes += 1;
          return fs.writeSync(descriptor, value, offset, Math.min(length, 2));
        },
      },
    });
    expect(writes).toBeGreaterThan(1);
    expect(fs.readFileSync(target, "utf8")).toBe("partial\n");

    const zeroTarget = join(root, "zero.jsonl");
    let closes = 0;
    expect(() =>
      durableAppendBytes(zeroTarget, bytes, {
        dependencies: {
          write: () => 0,
          close(descriptor): void {
            closes += 1;
            fs.closeSync(descriptor);
          },
        },
      }),
    ).toThrow(/no progress/i);
    expect(closes).toBe(1);
    expect(() => durableAppendBytes(join(root, "empty.jsonl"), new Uint8Array())).toThrow(/empty/i);
    expect(fs.existsSync(join(root, "empty.jsonl"))).toBeFalse();
  });
});
