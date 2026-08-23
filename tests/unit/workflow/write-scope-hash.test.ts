import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
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
});
