import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { dirname } from "node:path";
import * as coreModule from "../../src/core/index.ts";
import { ChatError, readerLockPath } from "../../src/core/index.ts";
import { withReaderLock } from "../../src/cursor/store.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";

describe("Reader lock room isolation and store hardening", () => {
  const vfs = new ChatVirtualFS();
  let capturedLockPath = "";

  const withLockSpy = spyOn(coreModule, "withLock").mockImplementation(
    <R>(lockPath: string, action: () => R | Promise<R>): R | Promise<R> => {
      capturedLockPath = lockPath;
      vfs.mkdirSync(dirname(lockPath), { recursive: true });
      vfs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, holder: "vfs-test" }));
      let isPromise = false;
      try {
        const result = action();
        if (
          typeof result === "object" &&
          result !== null &&
          "then" in result &&
          typeof (result as { then: unknown }).then === "function"
        ) {
          isPromise = true;
          return (result as Promise<R>).finally(() => {
            if (vfs.existsSync(lockPath)) {
              vfs.unlinkSync(lockPath);
            }
          });
        }
        return result;
      } finally {
        if (!isPromise && vfs.existsSync(lockPath)) {
          vfs.unlinkSync(lockPath);
        }
      }
    },
  );

  beforeEach(() => {
    vfs.reset();
    capturedLockPath = "";
  });

  afterAll(() => {
    withLockSpy.mockRestore();
  });

  it("acquires lock in rooms/room-alpha/locks/readers/reader-1.lock and returns expected result", () => {
    let observedInVfs = false;
    const result = withReaderLock("room-alpha", "reader-1", () => {
      observedInVfs = vfs.existsSync(readerLockPath("room-alpha", "reader-1"));
      return 42;
    });

    expect(result).toBe(42);
    expect(observedInVfs).toBe(true);
    expect(capturedLockPath).toContain("rooms/room-alpha/locks");
    expect(capturedLockPath.endsWith("reader-1.lock")).toBe(true);
    expect(capturedLockPath).toBe(readerLockPath("room-alpha", "reader-1"));
    expect(vfs.existsSync(capturedLockPath)).toBe(false);
  });

  it("acquires lock asynchronously for room and reader and returns expected result", async () => {
    let observedInVfs = false;
    const result = await withReaderLock("room-alpha", "reader-1", async () => {
      observedInVfs = vfs.existsSync(readerLockPath("room-alpha", "reader-1"));
      return 42;
    });

    expect(result).toBe(42);
    expect(observedInVfs).toBe(true);
    expect(capturedLockPath).toContain("rooms/room-alpha/locks");
    expect(capturedLockPath.endsWith("reader-1.lock")).toBe(true);
    expect(vfs.existsSync(capturedLockPath)).toBe(false);
  });

  it("throws ChatError with INVALID_ARGUMENT when called without room or lockPath", () => {
    let caughtError: unknown;
    try {
      withReaderLock("plain-id", () => 42);
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError instanceof ChatError).toBe(true);
    expect((caughtError as ChatError).code).toBe("INVALID_ARGUMENT");
    expect((caughtError as ChatError).message).toContain(
      "withReaderLock requires room and readerId or an absolute lockPath",
    );
    expect(capturedLockPath).toBe("");
  });

  it("executes and returns when an explicit lockPath is provided", () => {
    let observedInVfs = false;
    const result = withReaderLock("/custom/path.lock", () => {
      observedInVfs = vfs.existsSync("/custom/path.lock");
      return 100;
    });

    expect(result).toBe(100);
    expect(observedInVfs).toBe(true);
    expect(capturedLockPath).toBe("/custom/path.lock");
    expect(vfs.existsSync("/custom/path.lock")).toBe(false);
  });

  it("executes asynchronously and returns when an explicit lockPath is provided", async () => {
    let observedInVfs = false;
    const result = await withReaderLock("/custom/path.lock", async () => {
      observedInVfs = vfs.existsSync("/custom/path.lock");
      return 100;
    });

    expect(result).toBe(100);
    expect(observedInVfs).toBe(true);
    expect(capturedLockPath).toBe("/custom/path.lock");
    expect(vfs.existsSync("/custom/path.lock")).toBe(false);
  });
});
