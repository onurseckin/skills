import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  hashWriteScope,
  type HashWriteScopeDependencies,
} from "../../../../olt/scripts/src/workflow/lease/write-scope-hash.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

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
  const root = `/virtual/scope-core-${++scopeCounter}`;
  vfsInstance!.mkdirSync(root, { recursive: true });

  for (const [relPath, content] of Object.entries(initialFiles)) {
    const fullPath = join(root, relPath);
    vfsInstance!.mkdirSync(join(fullPath, ".."), { recursive: true });
    vfsInstance!.writeFileSync(fullPath, content);
  }

  return {
    root,
    dependencies: {},
    setFile(relPath: string, content: string) {
      const fullPath = join(root, relPath);
      vfsInstance!.mkdirSync(join(fullPath, ".."), { recursive: true });
      vfsInstance!.writeFileSync(fullPath, content);
    },
    deleteFile(relPath: string) {
      vfsInstance!.rmSync(join(root, relPath), { force: true });
    },
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

describe("hashWriteScope in-memory virtualization", () => {
  test("is stable across two readings of unchanged content", () => {
    const vfs = createVirtualScope({ "src/a.ts": "export const a = 1;\n" });
    const first = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);
    const second = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);
    expect(first).toBe(second);
  });

  test("changes when a file's content changes", () => {
    const vfs = createVirtualScope({ "src/a.ts": "export const a = 1;\n" });
    const before = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);

    vfs.setFile("src/a.ts", "export const a = 2;\n");
    const after = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);

    expect(after).not.toBe(before);
  });

  test("does not change when only mtime changes — content, never mtime", () => {
    const vfs = createVirtualScope({ "src/a.ts": "export const a = 1;\n" });
    const before = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);
    const after = hashWriteScope(vfs.root, ["src/a.ts"], vfs.dependencies);
    expect(after).toBe(before);
  });

  test("changes when a new file is added inside the scope", () => {
    const vfs = createVirtualScope({ "src/a.ts": "export const a = 1;\n" });
    const before = hashWriteScope(vfs.root, ["src/a.ts", "src/b.ts"], vfs.dependencies);

    vfs.setFile("src/b.ts", "export const b = 1;\n");
    const after = hashWriteScope(vfs.root, ["src/a.ts", "src/b.ts"], vfs.dependencies);

    expect(after).not.toBe(before);
  });

  test("changes when a file inside the scope is deleted", () => {
    const vfs = createVirtualScope({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });
    const before = hashWriteScope(vfs.root, ["src/a.ts", "src/b.ts"], vfs.dependencies);

    vfs.deleteFile("src/b.ts");
    const after = hashWriteScope(vfs.root, ["src/a.ts", "src/b.ts"], vfs.dependencies);

    expect(after).not.toBe(before);
  });

  test("a scope naming a file that does not exist yet hashes the same as an absent path", () => {
    const vfs = createVirtualScope({});
    const beforeCreation = hashWriteScope(vfs.root, ["src/planned.ts"], vfs.dependencies);

    vfs.setFile("src/planned.ts", "export const planned = true;\n");
    const afterCreation = hashWriteScope(vfs.root, ["src/planned.ts"], vfs.dependencies);

    expect(afterCreation).not.toBe(beforeCreation);
  });

  test.each(["EACCES", "EIO"])(
    "refuses a write scope entry that lstat cannot inspect: %s",
    (code) => {
      const vfs = createVirtualScope({
        "src/blocked.ts": "export const blocked = true;\n",
      });
      const blockedPath = join(vfs.root, "src", "blocked.ts");
      const cause = `simulated ${code.toLowerCase()}`;

      try {
        hashWriteScope(vfs.root, ["src/blocked.ts"], {
          ...vfs.dependencies,
          lstat(path) {
            if (path === blockedPath) {
              const error = Object.assign(new Error(cause), { code });
              throw error;
            }
            return vfs.dependencies.lstat!(path);
          },
        });
        throw new Error("expected hashWriteScope to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(HarnessError);
        expect(error).toMatchObject({
          code: "INTEGRITY",
          message: `write scope entry could not be inspected: ${blockedPath}: ${cause}`,
        });
      }
    },
  );

  test("accepts an ENOENT lstat result identically to an absent scope path", () => {
    const vfs = createVirtualScope({});
    const missingPath = join(vfs.root, "src", "planned.ts");
    const expected = hashWriteScope(vfs.root, ["src/planned.ts"], vfs.dependencies);

    const actual = hashWriteScope(vfs.root, ["src/planned.ts"], {
      ...vfs.dependencies,
      lstat(path) {
        if (path === missingPath) {
          throw Object.assign(new Error("simulated missing path"), { code: "ENOENT" });
        }
        return vfs.dependencies.lstat!(path);
      },
    });

    expect(actual).toBe(expected);
  });

  test.each([
    [17, "17"],
    [Object.create({ code: "ENOENT" }), "unknown error"],
  ])("refuses an lstat throw without an own ENOENT data property", (thrown, cause) => {
    const vfs = createVirtualScope({});
    const scopedPath = join(vfs.root, "src", "planned.ts");

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/planned.ts"], {
          ...vfs.dependencies,
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      cause,
    );
  });

  test("refuses an lstat throw whose code getter cannot be inspected", () => {
    const vfs = createVirtualScope({});
    const scopedPath = join(vfs.root, "src", "planned.ts");
    const thrown = {};
    Object.defineProperty(thrown, "code", {
      get() {
        throw new Error("code getter was invoked");
      },
    });
    Object.defineProperty(thrown, "message", { value: "uninspectable code" });

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/planned.ts"], {
          ...vfs.dependencies,
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      "uninspectable code",
    );
  });

  test("refuses an lstat proxy that cannot be inspected", () => {
    const vfs = createVirtualScope({});
    const scopedPath = join(vfs.root, "src", "planned.ts");
    const thrown = new Proxy(
      { message: "hidden" },
      {
        get() {
          throw new Error("proxy get trap was invoked");
        },
        getOwnPropertyDescriptor() {
          throw new Error("proxy descriptor trap was invoked");
        },
      },
    );

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/planned.ts"], {
          ...vfs.dependencies,
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      "unknown error",
    );
  });

  test("refuses an ENOTDIR lstat failure", () => {
    const vfs = createVirtualScope({});
    const scopedPath = join(vfs.root, "src", "planned.ts");

    expectIntegrity(
      () =>
        hashWriteScope(vfs.root, ["src/planned.ts"], {
          ...vfs.dependencies,
          lstat() {
            throw Object.assign(new Error("simulated enotdir"), { code: "ENOTDIR" });
          },
        }),
      scopedPath,
      "simulated enotdir",
    );
  });
});
