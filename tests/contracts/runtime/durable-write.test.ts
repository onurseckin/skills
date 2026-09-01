import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  atomicWriteBytes,
  atomicWriteJson,
  durableAppendBytes,
  fsyncDirectory,
  isTestMode,
  type DurableWriteStep,
} from "../../../olt/scripts/src/core/durable-write.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "../../reporting/browser/browser-virtual-fs.ts";

export const durableWriteSuiteName = "durable-write & atomic file operations";

describe(durableWriteSuiteName, () => {
  beforeEach(() => {
    setupVirtualBrowserFS();
  });

  afterEach(() => {
    cleanupVirtualBrowserFS();
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
    const dir = tempDir("lifecycle");
    const target = join(dir, "atomic-test.txt");

    const steps: DurableWriteStep[] = [];
    const payload = new TextEncoder().encode("hello durable atomic write");

    atomicWriteBytes(target, payload, {
      mode: 0o640,
      observe: (step) => steps.push(step),
    });

    expect(steps).toEqual(["chmod", "file-fsync", "rename", "directory-fsync"]);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("hello durable atomic write");
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
  });

  test("atomicWriteBytes automatically creates non-existent parent directories in test mode", () => {
    const dir = tempDir("nested-sub-dir");
    const target = join(dir, "auto-parent.txt");
    const payload = new TextEncoder().encode("nested content");

    atomicWriteBytes(target, payload);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe("nested content");
  });

  test("atomicWriteBytes cleans up temporary file and descriptor on early write failure", () => {
    const dir = tempDir("failure-cleanup");
    const target = join(dir, "failed.txt");

    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("data"), {
        observe: (step) => {
          if (step === "file-fsync") throw new Error("simulated failure after fsync");
        },
      }),
    ).toThrow(/simulated failure/);

    expect(fs.existsSync(target)).toBe(false);
  });

  test("atomicWriteBytes handles post-rename failure when directory fsync throws", () => {
    const dir = tempDir("dir-fsync-fail");
    const target = join(dir, "target.txt");

    expect(() =>
      atomicWriteBytes(target, new TextEncoder().encode("payload"), {
        observe: (step) => {
          if (step === "directory-fsync") throw new Error("simulated directory fsync failure");
        },
      }),
    ).toThrow(/simulated directory fsync failure/);

    expect(fs.existsSync(target)).toBe(true);
  });

  test("durableAppendBytes appends records and triggers observe steps without physical fsync barriers", () => {
    const dir = tempDir("append-observe");
    const target = join(dir, "events.jsonl");
    const steps: DurableWriteStep[] = [];

    durableAppendBytes(target, new TextEncoder().encode("record-1\n"), {
      observe: (step) => steps.push(step),
    });
    durableAppendBytes(target, new TextEncoder().encode("record-2\n"), {
      observe: (step) => steps.push(step),
    });

    expect(steps).toEqual(["file-fsync", "directory-fsync", "file-fsync", "directory-fsync"]);
    expect(fs.readFileSync(target, "utf-8")).toBe("record-1\nrecord-2\n");
  });

  test("durableAppendBytes rejects empty records and validates durations", () => {
    const dir = tempDir("append-validation");
    const target = join(dir, "empty.jsonl");

    expect(() => durableAppendBytes(target, new Uint8Array())).toThrow(/empty record/i);
    expect(() =>
      durableAppendBytes(target, new TextEncoder().encode("data\n"), {
        timeoutMs: -1,
      }),
    ).toThrow(/timeoutMs must be finite/i);
  });

  test("durableAppendBytes supports custom dependency injection for determinism and error propagation", () => {
    const dir = tempDir("append-deps");
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
    expect(fs.readFileSync(target, "utf-8")).toBe("custom-dep\n");
  });

  test("atomicWriteJson writes canonical formatted JSON bytes with configured mode", () => {
    const dir = tempDir("json-write");
    const target = join(dir, "payload.json");

    atomicWriteJson(target, { z: 1, a: "two", nested: { bool: true } }, 0o600);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe('{"a":"two","nested":{"bool":true},"z":1}');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);

    const defaultModeTarget = join(dir, "default-mode.json");
    atomicWriteJson(defaultModeTarget, { count: 1 });
    expect(fs.existsSync(defaultModeTarget)).toBe(true);
  });

  test("fsyncDirectory safely syncs an existing directory without throwing", () => {
    const dir = tempDir("fsync-dir");
    expect(() => fsyncDirectory(dir)).not.toThrow();
  });
});
