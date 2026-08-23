import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertGatePathBindings,
  captureGatePathBindings,
  executionArgv,
  gatePathBindingIssues,
} from "../../../olt/scripts/src/engine/runner/gate-path-bindings.ts";
import { gateControlBindingsOverlapWriteScopes } from "../../../olt/scripts/src/engine/runner/gate-path-overlap.ts";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gate-path-binding-"));
  roots.push(root);
  await mkdir(join(root, "tools"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("gate path identity binding", () => {
  test("captures a canonical regular executable and rechecks its digest", async () => {
    const root = await repository();
    const executable = join(root, "tools", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);

    const bindings = captureGatePathBindings(root, root, ["./tools/verify"]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      argv_index: 0,
      argument: "./tools/verify",
      scope: "repository",
      role: "executable",
      relative_path: "tools/verify",
      kind: "file",
      executable: true,
      bytes: 17,
      sha256: createHash("sha256").update("#!/bin/sh\nexit 0\n").digest("hex"),
    });
    expect(bindings[0]!.device).toMatch(/^\d+$/u);
    expect(bindings[0]!.inode).toMatch(/^\d+$/u);
    expect(gatePathBindingIssues(root, root, ["./tools/verify"], bindings)).toEqual([]);
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["tools"]])).toBeTrue();
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src"]])).toBeFalse();

    await writeFile(executable, "#!/bin/sh\nexit 1\n");
    expect(gatePathBindingIssues(root, root, ["./tools/verify"], bindings).join("\n")).toMatch(
      /identity|digest|changed/i,
    );
  });

  test("rejects final and intermediate symlinks before spawn", async () => {
    const root = await repository();
    await symlink("/usr/bin/true", join(root, "tools", "external"));
    expect(() => captureGatePathBindings(root, root, ["./tools/external"])).toThrow(/symbolic/i);

    await symlink("/usr/bin", join(root, "outside"));
    expect(() => captureGatePathBindings(root, root, ["./outside/true"])).toThrow(/symbolic/i);
  });

  test("binds runtime script and target paths without requiring them to be executable", async () => {
    const root = await repository();
    await writeFile(join(root, "tools", "verify.ts"), "console.log('ok');\n");
    await mkdir(join(root, "tests"));
    const bindings = captureGatePathBindings(root, root, ["bun", "tools/verify.ts", "tests"]);
    expect(
      bindings
        .filter(({ scope }) => scope === "repository")
        .map(({ relative_path }) => relative_path),
    ).toEqual(["tools/verify.ts", "tests"]);
    const repositoryBindings = bindings.filter(({ scope }) => scope === "repository");
    expect(repositoryBindings.every(({ executable }) => !executable)).toBeTrue();
    expect(repositoryBindings.map(({ role }) => role)).toEqual(["program", "target"]);
  });

  test("binds a bare PATH executable to its canonical system identity", async () => {
    const root = await repository();
    const bin = await mkdtemp(join(tmpdir(), "gate-path-bin-"));
    roots.push(bin);
    const executable = join(bin, "gate-tool");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);

    const bindings = captureGatePathBindings(root, root, ["gate-tool"], bin);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      argument: "gate-tool",
      scope: "system",
      role: "executable",
      canonical_path: realpathSync(executable),
      kind: "file",
      executable: true,
    });
    expect(bindings[0]!.relative_path).toBeUndefined();
  });

  test("recursively binds and rewrites env and command wrapper executables", async () => {
    const root = await repository();
    const bin = await mkdtemp(join(tmpdir(), "gate-wrapper-bin-"));
    roots.push(bin);
    const tool = join(bin, "gate-tool");
    await writeFile(tool, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const pathValue = `/usr/bin:${bin}`;
    const argv = ["env", "command", "gate-tool", "tests"];
    const bindings = captureGatePathBindings(root, root, argv, pathValue);
    expect(
      bindings.filter(({ role }) => role === "executable").map(({ argv_index }) => argv_index),
    ).toEqual([0, 1, 2]);
    expect(executionArgv(argv, bindings).slice(0, 3)).toEqual([
      "/usr/bin/env",
      "/usr/bin/command",
      realpathSync(tool),
    ]);
  });

  test("recursively binds directory contents and rejects mutation before spawn", async () => {
    const root = await repository();
    await mkdir(join(root, "tests", "nested"), { recursive: true });
    await writeFile(join(root, "tests", "nested", "one.test.ts"), "test('one', () => {});\n");
    const bindings = captureGatePathBindings(root, root, ["bun", "test", "tests"]);
    const target = bindings.find(({ relative_path }) => relative_path === "tests")!;
    expect(target).toMatchObject({ role: "target", kind: "directory", entries: 2 });
    expect(target.tree_sha256).toMatch(/^[a-f0-9]{64}$/u);

    await symlink("/usr/bin/true", join(root, "tests", "nested", "external"));
    expect(() => captureGatePathBindings(root, root, ["bun", "test", "tests"])).toThrow(
      /symlink|escape|outside/i,
    );
    await rm(join(root, "tests", "nested", "external"));

    await writeFile(join(root, "tests", "nested", "one.test.ts"), "test('changed', () => {});\n");
    expect(() => assertGatePathBindings(root, root, ["bun", "test", "tests"], bindings)).toThrow(
      /identity|digest|changed/i,
    );
  });
});
