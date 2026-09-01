import { describe, expect, test } from "bun:test";
import { openSync, type Stats } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  hashWriteScope,
  type HashWriteScopeDependencies,
} from "../../../../olt/scripts/src/workflow/lease/write-scope-hash.ts";

const ROOT = process.cwd();

function createVirtualScope(initialFiles: Record<string, string> = {}) {
  const fileMap = new Map<string, Buffer>();
  const descriptors = new Map<number, { buffer: Buffer; position: number }>();

  for (const [relPath, content] of Object.entries(initialFiles)) {
    fileMap.set(join(ROOT, relPath), Buffer.from(content, "utf8"));
  }

  const dependencies: HashWriteScopeDependencies = {
    lstat(path: string): Stats {
      const buf = fileMap.get(path);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), {
          code: "ENOENT",
        });
      }
      return {
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false,
        size: buf.length,
      } as unknown as Stats;
    },
    open(path: string): number {
      const buf = fileMap.get(path);
      if (!buf) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
          code: "ENOENT",
        });
      }
      const fd = openSync(import.meta.filename, "r");
      descriptors.set(fd, { buffer: buf, position: 0 });
      return fd;
    },
    read(descriptor: number, buffer: Buffer, offset: number, length: number): number {
      const handle = descriptors.get(descriptor);
      if (!handle) throw Object.assign(new Error("EBADF: bad descriptor"), { code: "EBADF" });
      const available = handle.buffer.length - handle.position;
      if (available <= 0) return 0;
      const count = Math.min(length, available);
      handle.buffer.copy(buffer, offset, handle.position, handle.position + count);
      handle.position += count;
      return count;
    },
  };

  return {
    root: ROOT,
    dependencies,
  };
}

function expectIntegrity(operation: () => void, path: string, cause: string): void {
  let received: unknown;
  try {
    operation();
  } catch (error) {
    received = error;
  }
  expect(received).toBeInstanceOf(HarnessError);
  expect(received).toMatchObject({
    code: "INTEGRITY",
    message: `write scope entry could not be inspected: ${path}: ${cause}`,
  });
}

describe("assertWriteScopeUnmodified and validation in-memory virtualization", () => {
  test("refuses an EIO lstat failure in a scoped child", () => {
    const vfs = createVirtualScope({ "src/blocked.ts": "export const blocked = true;\n" });
    const blockedPath = join(vfs.root, "src", "blocked.ts");

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/blocked.ts"], {
          ...vfs.dependencies,
          lstat(path) {
            if (path === blockedPath) {
              throw Object.assign(new Error("simulated child eio"), { code: "EIO" });
            }
            return vfs.dependencies.lstat!(path);
          },
        }),
      blockedPath,
      "simulated child eio",
    );
  });

  test("accepts an open ENOENT race identically to an absent scope path", () => {
    const vfs = createVirtualScope({ "src/fixture.ts": "export const fixture = true;\n" });
    const scopedPath = join(vfs.root, "src", "planned.ts");
    const expected = hashWriteScope(vfs.root, ["src/planned.ts"], vfs.dependencies);

    const actual = hashWriteScope(vfs.root, ["src/planned.ts"], {
      ...vfs.dependencies,
      lstat(path) {
        if (path === scopedPath) return vfs.dependencies.lstat!(join(vfs.root, "src/fixture.ts"));
        return vfs.dependencies.lstat!(path);
      },
      open() {
        throw Object.assign(new Error("simulated open race"), { code: "ENOENT" });
      },
    });

    expect(actual).toBe(expected);
  });

  test("accepts a read ENOENT race identically to an absent scope path", () => {
    const vfs = createVirtualScope({ "src/entry.ts": "export const entry = true;\n" });
    const expected = hashWriteScope(vfs.root, ["src/planned.ts"], vfs.dependencies);

    const actual = hashWriteScope(vfs.root, ["src/entry.ts"], {
      ...vfs.dependencies,
      read() {
        throw Object.assign(new Error("simulated read race"), { code: "ENOENT" });
      },
    });

    expect(actual).toBe(expected);
  });

  test.each([
    ["open", "EACCES", "simulated open access"],
    ["read", "EIO", "simulated read io"],
  ])("refuses a non-ENOENT %s failure while hashing", (operation, code, cause) => {
    const vfs = createVirtualScope({ "src/entry.ts": "export const entry = true;\n" });
    const scopedPath = join(vfs.root, "src", "entry.ts");
    const error = Object.assign(new Error(cause), { code });

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/entry.ts"], {
          ...vfs.dependencies,
          ...(operation === "open"
            ? {
                open() {
                  throw error;
                },
              }
            : {
                read() {
                  throw error;
                },
              }),
        }),
      scopedPath,
      cause,
    );
  });

  test("is independent of directory traversal order", () => {
    const vfs = createVirtualScope({
      "src/a.ts": "export const a = 1;\n",
      "src/z.ts": "export const z = 1;\n",
    });

    const inOrder = hashWriteScope(vfs.root, ["src/a.ts", "src/z.ts"], vfs.dependencies);
    const reversed = hashWriteScope(vfs.root, ["src/z.ts", "src/a.ts"], vfs.dependencies);
    expect(inOrder).toBe(reversed);
  });

  test("a write scope outside the repository root is refused", () => {
    expect(() => hashWriteScope(ROOT, ["../escaped"])).toThrow(HarnessError);
  });

  test("a symlink inside the scope is refused rather than silently followed", () => {
    const vfs = createVirtualScope({ "src/link.ts": "export const link = true;\n" });
    const symlinkPath = join(vfs.root, "src", "link.ts");

    expect(() =>
      hashWriteScope(vfs.root, ["src/link.ts"], {
        ...vfs.dependencies,
        lstat(path) {
          if (path === symlinkPath) {
            return {
              isFile: () => false,
              isDirectory: () => false,
              isSymbolicLink: () => true,
              size: 10,
            } as unknown as Stats;
          }
          return vfs.dependencies.lstat!(path);
        },
      }),
    ).toThrow(HarnessError);
  });

  test("safeCause handles errors where toString throws", () => {
    const vfs = createVirtualScope({});
    const scopedPath = join(vfs.root, "src", "planned.ts");

    const weirdError = Object.create(null);
    Object.defineProperty(weirdError, "toString", {
      value: () => {
        throw new Error("toString failed");
      },
    });

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/planned.ts"], {
          ...vfs.dependencies,
          lstat() {
            throw weirdError;
          },
        }),
      scopedPath,
      "unknown error",
    );
  });
});
