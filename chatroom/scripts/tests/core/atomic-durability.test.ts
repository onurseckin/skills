import { describe, expect, it } from "bun:test";
import {
  acquireLock,
  appendAtomic,
  releaseLock,
  safeFsync,
  writeAtomic,
} from "../../src/core/index.ts";

function makeFsError(
  code: string,
  message = `Simulated ${code}`,
): Error & { readonly code: string } {
  const error = new Error(message);
  return Object.assign(error, { code });
}

describe("safeFsync", () => {
  it("succeeds normally when fsyncFn completes without error", () => {
    let calledFd = -1;
    const mockFsync = (fd: number): void => {
      calledFd = fd;
    };
    expect(() => safeFsync(7, mockFsync)).not.toThrow();
    expect(calledFd).toBe(7);
  });

  it("tolerates EINVAL, ENOTSUP, and ENOSYS error codes", () => {
    for (const code of ["EINVAL", "ENOTSUP", "ENOSYS"]) {
      let called = false;
      const mockFsync = (): void => {
        called = true;
        throw makeFsError(code);
      };
      expect(() => safeFsync(12, mockFsync)).not.toThrow();
      expect(called).toBe(true);
    }
  });

  it("throws on EIO, ENOSPC, or standard Error without code", () => {
    for (const code of ["EIO", "ENOSPC"]) {
      const mockFsync = (): void => {
        throw makeFsError(code);
      };
      let caught: unknown = null;
      try {
        safeFsync(15, mockFsync);
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error & { readonly code?: string }).code).toBe(code);
    }

    const standardErrorFsync = (): void => {
      throw new Error("Standard disk failure");
    };
    expect(() => safeFsync(15, standardErrorFsync)).toThrow("Standard disk failure");
  });

  it("rethrows non-object or null exceptions unchanged", () => {
    const primitiveFsync = (): void => {
      throw "disk fault";
    };
    expect(() => safeFsync(15, primitiveFsync)).toThrow("disk fault");
  });
});

describe("writeAtomic durability", () => {
  it("throws on simulated EIO and propagates error without swallowing", () => {
    const testPath = `/tmp/test-atomic-durability-write-eio-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let fsyncInvocations = 0;
    const simulatedError = makeFsError("EIO", "Unrecoverable hardware error");
    const eioFsync = (fd: number): void => {
      fsyncInvocations++;
      expect(fd).toBeGreaterThan(0);
      throw simulatedError;
    };

    let caughtError: unknown = null;
    try {
      writeAtomic(testPath, "sample data", { fsync: eioFsync });
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(fsyncInvocations).toBe(1);
    expect(caughtError).toBe(simulatedError);
    expect((caughtError as Error & { readonly code?: string }).code).toBe("EIO");
  });

  it("tolerates simulated EINVAL via safeFsync", () => {
    const testPath = `/tmp/test-atomic-durability-write-einval-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let fsyncInvocations = 0;
    const einvalFsync = (fd: number): void => {
      fsyncInvocations++;
      safeFsync(fd, () => {
        throw makeFsError("EINVAL");
      });
    };

    expect(() => {
      writeAtomic(testPath, "sample data", { fsync: einvalFsync });
    }).not.toThrow();
    expect(fsyncInvocations).toBe(1);
  });
});

describe("appendAtomic durability", () => {
  it("throws on simulated EIO and propagates error without swallowing", () => {
    const testPath = `/tmp/test-atomic-durability-append-eio-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let fsyncInvocations = 0;
    const simulatedError = makeFsError("EIO", "Append sync hardware failure");
    const eioFsync = (fd: number): void => {
      fsyncInvocations++;
      expect(fd).toBeGreaterThan(0);
      throw simulatedError;
    };

    let caughtError: unknown = null;
    try {
      appendAtomic(testPath, "sample append data", { fsync: eioFsync });
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(fsyncInvocations).toBe(1);
    expect(caughtError).toBe(simulatedError);
    expect((caughtError as Error & { readonly code?: string }).code).toBe("EIO");
  });

  it("tolerates simulated EINVAL via safeFsync", () => {
    const testPath = `/tmp/test-atomic-durability-append-einval-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let fsyncInvocations = 0;
    const einvalFsync = (fd: number): void => {
      fsyncInvocations++;
      safeFsync(fd, () => {
        throw makeFsError("EINVAL");
      });
    };

    let result: { readonly offset: number; readonly bytesWritten: number } | null = null;
    expect(() => {
      result = appendAtomic(testPath, "sample append data", { fsync: einvalFsync });
    }).not.toThrow();
    expect(fsyncInvocations).toBe(1);
    expect(result).not.toBeNull();
    expect(result?.bytesWritten).toBeGreaterThan(0);
  });
});

describe("acquireLock durability", () => {
  it("throws on simulated EIO and propagates error without swallowing", () => {
    const lockPath = `/tmp/test-atomic-durability-lock-eio-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`;
    let fsyncInvocations = 0;
    const simulatedError = makeFsError("EIO", "Lock sync hardware failure");
    const eioFsync = (fd: number): void => {
      fsyncInvocations++;
      expect(fd).toBeGreaterThan(0);
      throw simulatedError;
    };

    let caughtError: unknown = null;
    try {
      acquireLock(lockPath, { fsync: eioFsync });
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(fsyncInvocations).toBe(1);
    expect(caughtError).toBe(simulatedError);
    expect((caughtError as Error & { readonly code?: string }).code).toBe("EIO");
  });

  it("tolerates simulated EINVAL via safeFsync", () => {
    const lockPath = `/tmp/test-atomic-durability-lock-einval-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`;
    let fsyncInvocations = 0;
    const einvalFsync = (fd: number): void => {
      fsyncInvocations++;
      safeFsync(fd, () => {
        throw makeFsError("EINVAL");
      });
    };

    try {
      expect(() => {
        acquireLock(lockPath, { fsync: einvalFsync });
      }).not.toThrow();
      expect(fsyncInvocations).toBe(1);
    } finally {
      releaseLock(lockPath);
    }
  });
});

describe("durability honesty vacuity check", () => {
  it("guarantees EIO is never swallowed by bare catch across all atomic operations", () => {
    const eioError = makeFsError("EIO", "Hardware I/O error");
    const throwingFsync = (): void => {
      throw eioError;
    };

    const writePath = `/tmp/test-vacuity-write-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let writeThrew = false;
    try {
      writeAtomic(writePath, "payload", { fsync: throwingFsync });
    } catch (error: unknown) {
      if (error === eioError) {
        writeThrew = true;
      }
    }
    expect(writeThrew).toBe(true);

    const appendPath = `/tmp/test-vacuity-append-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    let appendThrew = false;
    try {
      appendAtomic(appendPath, "payload", { fsync: throwingFsync });
    } catch (error: unknown) {
      if (error === eioError) {
        appendThrew = true;
      }
    }
    expect(appendThrew).toBe(true);

    const lockPath = `/tmp/test-vacuity-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`;
    let lockThrew = false;
    try {
      acquireLock(lockPath, { fsync: throwingFsync });
    } catch (error: unknown) {
      if (error === eioError) {
        lockThrew = true;
      }
    }
    expect(lockThrew).toBe(true);
  });
});
