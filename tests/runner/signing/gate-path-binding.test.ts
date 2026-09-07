import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  assertGatePathBindings,
  captureGatePathBindings,
  executionArgv,
  gatePathBindingIssues,
} from "../../../olt/scripts/src/engine/runner/signing/gate-path-bindings.ts";
import { gateControlBindingsOverlapWriteScopes } from "../../../olt/scripts/src/engine/runner/signing/gate-path-overlap.ts";
import {
  getRunnerVfs,
  tempRoot,
  createVirtualSymlink,
  removeVirtualSymlink,
  cleanupTempRoots,
} from "../command/fixture.ts";

afterEach(cleanupTempRoots);

function repository(): string {
  const root = tempRoot("gate-path-binding");
  const vfs = getRunnerVfs();
  vfs.mkdirSync(join(root, "tools"), { recursive: true });
  vfs.mkdirSync("/usr/bin", { recursive: true });
  if (!vfs.existsSync("/usr/bin/env")) {
    vfs.writeFileSync("/usr/bin/env", "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  if (!vfs.existsSync("/usr/bin/command")) {
    vfs.writeFileSync("/usr/bin/command", "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  if (!vfs.existsSync("/usr/bin/true")) {
    vfs.writeFileSync("/usr/bin/true", "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return root;
}

describe("gate path identity binding", () => {
  test("captures a canonical regular executable and rechecks its digest", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    const executable = join(root, "tools", "verify");
    vfs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const bindings = captureGatePathBindings(root, root, ["./tools/verify"]);
    expect(bindings).toHaveLength(1);
    const firstBinding = bindings[0];
    expect(firstBinding).toBeDefined();
    expect(firstBinding).toMatchObject({
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
    expect(firstBinding?.device).toMatch(/^\d+$/u);
    expect(firstBinding?.inode).toMatch(/^\d+$/u);
    expect(gatePathBindingIssues(root, root, ["./tools/verify"], bindings)).toEqual([]);
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["tools"]])).toBeTrue();
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src"]])).toBeFalse();

    vfs.writeFileSync(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    expect(gatePathBindingIssues(root, root, ["./tools/verify"], bindings).join("\n")).toMatch(
      /identity|digest|changed/i,
    );
  });

  test("rejects final and intermediate symlinks before spawn", () => {
    const root = repository();
    createVirtualSymlink("/usr/bin/true", join(root, "tools", "external"));
    expect(() => captureGatePathBindings(root, root, ["./tools/external"])).toThrow(/symbolic/i);

    createVirtualSymlink("/usr/bin", join(root, "outside"));
    expect(() => captureGatePathBindings(root, root, ["./outside/true"])).toThrow(/symbolic/i);
  });

  test("binds runtime script and target paths without requiring them to be executable", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    vfs.writeFileSync(join(root, "tools", "verify.ts"), "console.log('ok');\n");
    vfs.mkdirSync(join(root, "tests"), { recursive: true });
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

  test("binds a bare PATH executable to its canonical system identity", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    const bin = tempRoot("gate-path-bin");
    const executable = join(bin, "gate-tool");
    vfs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const bindings = captureGatePathBindings(root, root, ["gate-tool"], bin);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      argument: "gate-tool",
      scope: "system",
      role: "executable",
      canonical_path: executable.replace(/\\/g, "/"),
      kind: "file",
      executable: true,
    });
    expect(bindings[0]?.relative_path).toBeUndefined();
  });

  test("recursively binds and rewrites env and command wrapper executables", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    const bin = tempRoot("gate-wrapper-bin");
    const tool = join(bin, "gate-tool");
    vfs.writeFileSync(tool, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const pathValue = `/usr/bin:${bin}`;
    const argv = ["env", "command", "gate-tool", "tests"];
    const bindings = captureGatePathBindings(root, root, argv, pathValue);
    expect(
      bindings.filter(({ role }) => role === "executable").map(({ argv_index }) => argv_index),
    ).toEqual([0, 1, 2]);
    expect(executionArgv(argv, bindings).slice(0, 3)).toEqual([
      "/usr/bin/env",
      "/usr/bin/command",
      tool.replace(/\\/g, "/"),
    ]);
  });

  test("recursively binds directory contents and rejects mutation before spawn", () => {
    const root = repository();
    const vfs = getRunnerVfs();
    vfs.mkdirSync(join(root, "tests", "nested"), { recursive: true });
    vfs.writeFileSync(join(root, "tests", "nested", "one.test.ts"), "test('one', () => {});\n");
    const bindings = captureGatePathBindings(root, root, ["bun", "test", "tests"]);
    const target = bindings.find(({ relative_path }) => relative_path === "tests");
    expect(target).toBeDefined();
    expect(target).toMatchObject({ role: "target", kind: "directory", entries: 2 });
    expect(target?.tree_sha256).toMatch(/^[a-f0-9]{64}$/u);

    createVirtualSymlink("/usr/bin/true", join(root, "tests", "nested", "external"));
    expect(() => captureGatePathBindings(root, root, ["bun", "test", "tests"])).toThrow(
      /symlink|escape|outside/i,
    );
    removeVirtualSymlink(join(root, "tests", "nested", "external"));

    vfs.writeFileSync(join(root, "tests", "nested", "one.test.ts"), "test('changed', () => {});\n");
    expect(() => assertGatePathBindings(root, root, ["bun", "test", "tests"], bindings)).toThrow(
      /identity|digest|changed/i,
    );
  });
});
