import { describe, expect, test, afterAll } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  atomicWriteBytes,
  atomicWriteJson,
  fsyncDirectory,
  type DurableWriteStep,
} from "../../../olt/scripts/src/core/durable-write.ts";

describe("durable-write & atomic file operations", () => {
  const scratchBase = join(process.cwd(), "coverage", "scratch", "durable-write-tests");

  afterAll(() => {
    rmSync(scratchBase, { recursive: true, force: true });
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

    // Default mode test
    const defaultModeTarget = join(dir, "default-mode.json");
    atomicWriteJson(defaultModeTarget, { count: 1 });
    expect(existsSync(defaultModeTarget)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  test("fsyncDirectory safely syncs an existing directory", () => {
    const dir = join(scratchBase, "fsync-dir");
    mkdirSync(dir, { recursive: true });
    expect(() => fsyncDirectory(dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
