import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { hashWriteScope } from "../../../olt/scripts/src/workflow/lease/write-scope-hash.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repo(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `write-scope-hash-${name}-`));
  roots.push(dir);
  return dir;
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

describe("hashWriteScope", () => {
  test("is stable across two readings of unchanged content", async () => {
    const root = await repo("stable");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");

    const first = hashWriteScope(root, ["src"]);
    const second = hashWriteScope(root, ["src"]);
    expect(first).toBe(second);
  });

  test("changes when a file's content changes", async () => {
    const root = await repo("content-change");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    const before = hashWriteScope(root, ["src"]);

    await writeFile(join(root, "src", "a.ts"), "export const a = 2;\n");
    const after = hashWriteScope(root, ["src"]);

    expect(after).not.toBe(before);
  });

  test("does not change when only mtime changes — content, never mtime", async () => {
    const root = await repo("mtime-only");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    const before = hashWriteScope(root, ["src"]);

    // The exact rewrite a `git checkout`/rebase performs on files nobody touched: same bytes, a
    // fresh mtime. FORENSICS.md's stamped run is this scenario read as "work happened".
    const future = new Date(Date.now() + 60_000);
    await utimes(join(root, "src", "a.ts"), future, future);
    const after = hashWriteScope(root, ["src"]);

    expect(after).toBe(before);
  });

  test("changes when a new file is added inside the scope", async () => {
    const root = await repo("added-file");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    const before = hashWriteScope(root, ["src"]);

    await writeFile(join(root, "src", "b.ts"), "export const b = 1;\n");
    const after = hashWriteScope(root, ["src"]);

    expect(after).not.toBe(before);
  });

  test("changes when a file inside the scope is deleted", async () => {
    const root = await repo("deleted-file");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
    await writeFile(join(root, "src", "b.ts"), "export const b = 1;\n");
    const before = hashWriteScope(root, ["src"]);

    await rm(join(root, "src", "b.ts"));
    const after = hashWriteScope(root, ["src"]);

    expect(after).not.toBe(before);
  });

  test("a scope naming a file that does not exist yet hashes the same as an absent path", async () => {
    const root = await repo("not-yet-created");
    await mkdir(join(root, "src"), { recursive: true });

    const beforeCreation = hashWriteScope(root, ["src/planned.ts"]);
    await writeFile(join(root, "src", "planned.ts"), "export const planned = true;\n");
    const afterCreation = hashWriteScope(root, ["src/planned.ts"]);

    expect(afterCreation).not.toBe(beforeCreation);
  });

  test.each(["EACCES", "EIO"])(
    "refuses a write scope entry that lstat cannot inspect: %s",
    async (code) => {
      const root = await repo(`unreadable-${code.toLowerCase()}`);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "blocked.ts"), "export const blocked = true;\n");
      const blockedPath = join(await realpath(root), "src", "blocked.ts");
      const cause = `simulated ${code.toLowerCase()}`;

      try {
        hashWriteScope(root, ["src/blocked.ts"], {
          lstat(path) {
            if (path !== blockedPath) return lstatSync(path);
            const error = Object.assign(new Error(cause), { code });
            throw error;
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

  test("accepts an ENOENT lstat result identically to an absent scope path", async () => {
    const root = await repo("enoent");
    await mkdir(join(root, "src"), { recursive: true });
    const missingPath = join(await realpath(root), "src", "planned.ts");
    const expected = hashWriteScope(root, ["src/planned.ts"]);

    const actual = hashWriteScope(root, ["src/planned.ts"], {
      lstat(path) {
        if (path !== missingPath) return lstatSync(path);
        throw Object.assign(new Error("simulated missing path"), { code: "ENOENT" });
      },
    });

    expect(actual).toBe(expected);
  });

  test.each([
    [17, "17"],
    [Object.create({ code: "ENOENT" }), "unknown error"],
  ])("refuses an lstat throw without an own ENOENT data property", async (thrown, cause) => {
    const root = await repo("unsafe-lstat-throw");
    await mkdir(join(root, "src"), { recursive: true });
    const scopedPath = join(await realpath(root), "src", "planned.ts");

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src/planned.ts"], {
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      cause,
    );
  });

  test("refuses an lstat throw whose code getter cannot be inspected", async () => {
    const root = await repo("getter-lstat-code");
    await mkdir(join(root, "src"), { recursive: true });
    const scopedPath = join(await realpath(root), "src", "planned.ts");
    const thrown = {};
    Object.defineProperty(thrown, "code", {
      get() {
        throw new Error("code getter was invoked");
      },
    });
    Object.defineProperty(thrown, "message", { value: "uninspectable code" });

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src/planned.ts"], {
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      "uninspectable code",
    );
  });

  test("refuses an lstat proxy that cannot be inspected", async () => {
    const root = await repo("proxy-lstat-code");
    await mkdir(join(root, "src"), { recursive: true });
    const scopedPath = join(await realpath(root), "src", "planned.ts");
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
        hashWriteScope(root, ["src/planned.ts"], {
          lstat() {
            throw thrown;
          },
        }),
      scopedPath,
      "unknown error",
    );
  });

  test("refuses an ENOTDIR lstat failure", async () => {
    const root = await repo("enotdir-lstat");
    await mkdir(join(root, "src"), { recursive: true });
    const scopedPath = join(await realpath(root), "src", "planned.ts");

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src/planned.ts"], {
          lstat() {
            throw Object.assign(new Error("simulated enotdir"), { code: "ENOTDIR" });
          },
        }),
      scopedPath,
      "simulated enotdir",
    );
  });

  test("refuses an EIO lstat failure in a scoped directory child", async () => {
    const root = await repo("recursive-eio");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "blocked.ts"), "export const blocked = true;\n");
    const canonicalRoot = await realpath(root);
    const blockedPath = join(canonicalRoot, "src", "blocked.ts");

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src"], {
          lstat(path) {
            if (path === blockedPath)
              throw Object.assign(new Error("simulated child eio"), { code: "EIO" });
            return lstatSync(path);
          },
        }),
      blockedPath,
      "simulated child eio",
    );
  });

  test("accepts an open ENOENT race identically to an absent scope path", async () => {
    const root = await repo("open-enoent");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "fixture.ts"), "export const fixture = true;\n");
    const canonicalRoot = await realpath(root);
    const scopedPath = join(canonicalRoot, "src", "planned.ts");
    const expected = hashWriteScope(root, ["src/planned.ts"]);

    const actual = hashWriteScope(root, ["src/planned.ts"], {
      lstat(path) {
        if (path === scopedPath) return lstatSync(join(canonicalRoot, "fixture.ts"));
        return lstatSync(path);
      },
      open() {
        throw Object.assign(new Error("simulated open race"), { code: "ENOENT" });
      },
    });

    expect(actual).toBe(expected);
  });

  test("accepts a read ENOENT race identically to an absent scope path", async () => {
    const root = await repo("read-enoent");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "entry.ts"), "export const entry = true;\n");
    const expected = hashWriteScope(root, ["src/planned.ts"]);

    const actual = hashWriteScope(root, ["src/entry.ts"], {
      read() {
        throw Object.assign(new Error("simulated read race"), { code: "ENOENT" });
      },
    });

    expect(actual).toBe(expected);
  });

  test.each([
    ["open", "EACCES", "simulated open access"],
    ["read", "EIO", "simulated read io"],
  ])("refuses a non-ENOENT %s failure while hashing", async (operation, code, cause) => {
    const root = await repo(`hash-${operation}-${code.toLowerCase()}`);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "entry.ts"), "export const entry = true;\n");
    const scopedPath = join(await realpath(root), "src", "entry.ts");
    const error = Object.assign(new Error(cause), { code });

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src/entry.ts"], {
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

  test("is independent of directory traversal order", async () => {
    const root = await repo("order");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "z.ts"), "export const z = 1;\n");
    await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");

    const inOrder = hashWriteScope(root, ["src/a.ts", "src/z.ts"]);
    const reversed = hashWriteScope(root, ["src/z.ts", "src/a.ts"]);
    expect(inOrder).toBe(reversed);
  });

  test("a write scope outside the repository root is refused", async () => {
    const root = await repo("path-safety");
    expect(() => hashWriteScope(root, ["../escaped"])).toThrow(HarnessError);
  });

  test("a symlink inside the scope is refused rather than silently followed", async () => {
    const root = await repo("symlink");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "real.ts"), "export const real = true;\n");
    await symlink(join(root, "real.ts"), join(root, "src", "link.ts"));
    expect(() => hashWriteScope(root, ["src"])).toThrow(HarnessError);
  });

  test("safeCause handles errors where toString throws", async () => {
    const root = await repo("throwing-error");
    await mkdir(join(root, "src"), { recursive: true });
    const scopedPath = join(await realpath(root), "src", "planned.ts");

    const weirdError = Object.create(null);
    Object.defineProperty(weirdError, "toString", {
      value: () => {
        throw new Error("toString failed");
      },
    });

    expectIntegrity(
      () =>
        hashWriteScope(root, ["src/planned.ts"], {
          lstat() {
            throw weirdError;
          },
        }),
      scopedPath,
      "unknown error",
    );
  });
});
