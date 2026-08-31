import { describe, expect, test, afterAll } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWriteBytes,
  atomicWriteJson,
  durableAppendBytes,
  fsyncDirectory,
  isTestMode,
  type DurableWriteStep,
} from "../../olt/scripts/src/core/durable-write.ts";

describe("durable-write & atomic file operations", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "durable-write-contracts");

  afterAll(() => {
    try {
      rmSync(scratchBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test("isTestMode detects test environment correctly", () => {
    expect(isTestMode()).toBe(true);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalBunEnv = process.env.BUN_ENV;
    const originalVirtualFs = process.env.OLT_VIRTUAL_FS;
    try {
      delete process.env.NODE_ENV;
      delete process.env.BUN_ENV;
      process.env.OLT_VIRTUAL_FS = "1";
      expect(isTestMode()).toBe(true);

      delete process.env.OLT_VIRTUAL_FS;
      process.env.BUN_ENV = "test";
      expect(isTestMode()).toBe(true);

      delete process.env.BUN_ENV;
      process.env.NODE_ENV = "production";
      expect(isTestMode()).toBe(false);
    } finally {
      if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
      else delete process.env.NODE_ENV;
      if (originalBunEnv !== undefined) process.env.BUN_ENV = originalBunEnv;
      else delete process.env.BUN_ENV;
      if (originalVirtualFs !== undefined) process.env.OLT_VIRTUAL_FS = originalVirtualFs;
      else delete process.env.OLT_VIRTUAL_FS;
    }
  });

  test("atomicWriteBytes performs full atomic lifecycle and records all observation steps", () => {
    const dir = join(scratchBase, "lifecycle");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "atomic-test.txt");

    const steps: DurableWriteStep[] = [];
    const payload = new TextEncoder().encode("hello durable atomic write");

    atomicWriteBytes(target, payload, {
      mode: 0o640,
      observe: (step) => steps.push(step),
    });

    expect(steps).toEqual(["chmod", "file-fsync", "rename", "directory-fsync"]);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("hello durable atomic write");
    expect(statSync(target).mode & 0o777).toBe(0o640);

    rmSync(dir, { recursive: true, force: true });
  });

  test("atomicWriteBytes automatically creates non-existent parent directories in test mode", () => {
    const dir = join(scratchBase, "nested", "sub", "dir");
    const target = join(dir, "auto-parent.txt");
    const payload = new TextEncoder().encode("nested content");

    atomicWriteBytes(target, payload);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe("nested content");

    rmSync(join(scratchBase, "nested"), { recursive: true, force: true });
  });

  test("atomicWriteBytes cleans up temporary file and descriptor on early write failure", () => {
    const dir = join(scratchBase, "failure-cleanup");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "failed.txt");

    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("data"), {
        observe: (step) => {
          if (step === "file-fsync") throw new Error("simulated failure after fsync");
        },
      }),
    ).toThrow(/simulated failure/);

    expect(existsSync(target)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  test("atomicWriteBytes handles post-rename failure when directory fsync throws", () => {
    const dir = join(scratchBase, "dir-fsync-fail");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "target.txt");

    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("payload"), {
        observe: (step) => {
          if (step === "directory-fsync") throw new Error("simulated directory fsync failure");
        },
      }),
    ).toThrow(/simulated directory fsync failure/);

    expect(existsSync(target)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("durableAppendBytes appends records and triggers observe steps without physical fsync barriers", () => {
    const dir = join(scratchBase, "append-observe");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "events.jsonl");
    const steps: DurableWriteStep[] = [];

    durableAppendBytes(target, new TextEncoder().encode("record-1\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("record-2\n"), {
      observe: (step) => steps.push(step),
    });

    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
    expect(readFileSync(target, "utf-8")).toBe("record-1\nrecord-2\n");

    rmSync(dir, { recursive: true, force: true });
  });

  test("durableAppendBytes rejects empty records and validates durations", () => {
    const dir = join(scratchBase, "append-validation");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "empty.jsonl");

    expect(() => durableAppendBytes(target, new Uint8Array())).toThrow(/empty record/i);
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("data\n"), {
        timeoutMs: -1,
      }),
    ).toThrow(/timeoutMs must be finite/i);

    rmSync(dir, { recursive: true, force: true });
  });

  test("durableAppendBytes supports custom dependency injection for determinism and error propagation", () => {
    const dir = join(scratchBase, "append-deps");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "custom.jsonl");

    const order: string[] = [];
    let customFsyncCalled = false;

    durableAppendBytes(target, new TextEncoder().encode("custom-dep\n"), {
      dependencies: {
        fsync: () => {
          customFsyncCalled = true;
          order.push("custom-fsync");
        },
        fsyncDirectory: () => {
          order.push("custom-dir-sync");
        },
      },
    });

    expect(customFsyncCalled).toBe(true);
    expect(order).toEqual(["custom-fsync", "custom-dir-sync"]);
    expect(readFileSync(target, "utf-8")).toBe("custom-dep\n");

    rmSync(dir, { recursive: true, force: true });
  });

  test("atomicWriteJson writes canonical formatted JSON bytes with configured mode", () => {
    const dir = join(scratchBase, "json-write");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "payload.json");

    atomicWriteJson(target, { z: 1, a: "two", nested: { bool: true } }, 0o600);

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toBe('{"a":"two","nested":{"bool":true},"z":1}');
    expect(statSync(target).mode & 0o777).toBe(0o600);

    const defaultModeTarget = join(dir, "default-mode.json");
    atomicWriteJson(defaultModeTarget, { count: 1 });
    expect(existsSync(defaultModeTarget)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("fsyncDirectory safely syncs an existing directory without throwing", () => {
    const dir = join(scratchBase, "fsync-dir");
    mkdirSync(dir, { recursive: true });
    expect(() => fsyncDirectory(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
