import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstatSync, type Stats } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  hashWriteScope,
  type HashWriteScopeDependencies,
} from "../../../../olt/scripts/src/workflow/lease/write-scope-hash.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

const ROOT = "/virtual/root";
let vfsCleanup: (() => void) | undefined;
let vfsInstance: ReturnType<typeof setupWorkflowVirtualFs>["vfs"] | undefined;
let scopeCounter = 0;

beforeEach(() => {
  const setup = setupWorkflowVirtualFs();
  vfsCleanup = setup.cleanup;
  vfsInstance = setup.vfs;
});

afterEach(() => {
  vfsCleanup?.();
  vfsCleanup = undefined;
  vfsInstance = undefined;
});

function createVirtualScope(initialFiles: Record<string, string> = {}) {
  const root = `/virtual/scope-val-${++scopeCounter}`;
  vfsInstance!.mkdirSync(root, { recursive: true });

  for (const [relPath, content] of Object.entries(initialFiles)) {
    const fullPath = join(root, relPath);
    vfsInstance!.mkdirSync(join(fullPath, ".."), { recursive: true });
    vfsInstance!.writeFileSync(fullPath, content);
  }

  return {
    root,
    dependencies: {},
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
    const vfs = createVirtualScope({
      "src/child.ts": "export const child = true;\n",
    });
    const childPath = join(vfs.root, "src", "child.ts");
    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src"], {
          ...vfs.dependencies,
          lstat(path) {
            if (path === childPath) {
              throw Object.assign(new Error("simulated child eio"), { code: "EIO" });
            }
            return (vfs.dependencies.lstat ?? lstatSync)(path);
          },
        }),
      childPath,
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
        if (path === scopedPath)
          return (vfs.dependencies.lstat ?? lstatSync)(join(vfs.root, "src/fixture.ts"));
        return (vfs.dependencies.lstat ?? lstatSync)(path);
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
