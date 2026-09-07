import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  atomicWriteBytes,
  durableAppendBytes,
} from "../../../olt/scripts/src/core/durable-write.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("durable runtime files", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let rootCounter = 0;

  function fixture(): { root: string; source: string; destination: string } {
    const root = `/virtual-harness-runtime-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    const source = join(root, "source");
    vfs.mkdirSync(source, { recursive: true });
    ["src", "src/nested", "src/nested/__pycache__", "assets", "tests", "__pycache__"].forEach((p) =>
      vfs.mkdirSync(join(source, ...p.split("/")), { recursive: true }),
    );
    vfs.writeFileSync(join(source, "src", "nested", "tool.ts"), "export {}\n");
    vfs.writeFileSync(join(source, "src", "nested", "legacy.py"), "bad\n");
    vfs.writeFileSync(join(source, "src", "nested", "__pycache__", "legacy.pyc"), "bad\n");
    vfs.writeFileSync(join(source, "harness.ts"), "export {}\n");
    return { root, source, destination: join(root, "runtime") };
  }

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
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
    expect(session.statSync(target).mode & 0o777).toBe(0o440);
  });

  test("durableAppendBytes appends ordered records and syncs the file before its directory", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    const target = join(root, "events.jsonl");
    const steps: string[] = [];

    durableAppendBytes(target, new TextEncoder().encode("first\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("second\n"), {
      observe: (step) => steps.push(step),
    });

    expect(session.readFileSync(target, "utf8")).toBe("first\nsecond\n");
    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
  });

  test("durableAppendBytes holds its record lock through directory durability and rejects re-entry", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    const target = join(root, "events.jsonl");
    const order: string[] = [];
    let locked = false;
    let nestedRejected = false;
    const bytes = new TextEncoder().encode("outer\n");
    const dependencies = {
      open: session.openSync,
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
        return session.writeSync(descriptor, value, offset, length);
      },
      fsync(descriptor: number): void {
        order.push("file-fsync");
        session.fsyncSync(descriptor);
      },
      close(descriptor: number): void {
        order.push("close");
        session.closeSync(descriptor);
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
    expect(session.readFileSync(target, "utf8")).toBe("outer\n");
    expect(order).toEqual(["lock", "write", "file-fsync", "directory-fsync", "unlock", "close"]);
  });

  test("durableAppendBytes times out rather than interleaving with a held exclusive flock", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    const target = join(root, "events.jsonl");
    let attempts = 0;
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("blocked\n"), {
        timeoutMs: 4,
        retryMs: 1,
        dependencies: {
          tryExclusiveFlock: () => {
            attempts += 1;
            return false;
          },
        },
      }),
    ).toThrow(/timed out/i);
    expect(attempts).toBeGreaterThan(1);
    expect(session.existsSync(target)).toBeTrue();
  });

  test("durableAppendBytes keeps every tiny-write JSON record whole across partial writes", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
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
                return session.writeSync(descriptor, data, offset, Math.min(length, 1));
              },
            },
          },
        );
      }
    }

    const raw = session.readFileSync(target, "utf8");
    const records = (typeof raw === "string" ? raw : raw.toString("utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { worker: string; index: number });
    expect(records).toHaveLength(16);
    expect(new Set(records.map((record) => `${record.worker}:${record.index}`)).size).toBe(16);
  });

  test("durableAppendBytes retries partial writes and rejects zero-progress or empty records", () => {
    const root = `/virtual-core-dur-${++rootCounter}`;
    vfs.mkdirSync(root, { recursive: true });
    const target = join(root, "events.jsonl");
    const bytes = new TextEncoder().encode("partial\n");
    let writes = 0;
    durableAppendBytes(target, bytes, {
      dependencies: {
        write(descriptor, value, offset, length): number {
          writes += 1;
          return session.writeSync(descriptor, value, offset, Math.min(length, 2));
        },
      },
    });
    expect(writes).toBeGreaterThan(1);
    expect(session.readFileSync(target, "utf8")).toBe("partial\n");

    const zeroTarget = join(root, "zero.jsonl");
    let closes = 0;
    expect(() =>
      durableAppendBytes(zeroTarget, bytes, {
        dependencies: {
          write: () => 0,
          close(descriptor): void {
            closes += 1;
            session.closeSync(descriptor);
          },
        },
      }),
    ).toThrow(/no progress/i);
    expect(closes).toBe(1);
    expect(() => durableAppendBytes(join(root, "empty.jsonl"), new Uint8Array())).toThrow(/empty/i);
    expect(session.existsSync(join(root, "empty.jsonl"))).toBeFalse();
  });
});
