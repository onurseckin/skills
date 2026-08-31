import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  captureGatePathBindings,
  gatePathBindingIssues,
} from "../../../olt/scripts/src/engine/runner/signing/gate-path-bindings.ts";
import { gateControlBindingsOverlapWriteScopes } from "../../../olt/scripts/src/engine/runner/signing/gate-path-overlap.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";

const roots: string[] = [];
const stableRepository = {
  schema: "harness.repository-binding",
  version: 1,
  inspection_sha256: "a".repeat(64),
  git_identity_sha256: "b".repeat(64),
  content_sha256: "c".repeat(64),
  file_count: 1,
  total_bytes: 17,
} satisfies RepositoryBinding;
const observer = { inspectRepository: () => stableRepository };

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gate-path-binding-dyn-"));
  roots.push(root);
  await mkdir(join(root, "tools"));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("dynamic gate path bindings", () => {
  test("rejects repeated canonical directories before any recursive open or read", async () => {
    const root = await repository();
    await writeFile(join(root, "tools", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await mkdir(join(root, "suite"));
    await writeFile(join(root, "suite", "large.test.ts"), "x".repeat(64 * 1024));
    let opens = 0;
    let directoryReads = 0;
    let fileReads = 0;

    expect(() =>
      captureGatePathBindings(root, root, ["./tools/verify", "suite", "./suite"], undefined, {
        openPath: (path, flags) => {
          opens += 1;
          return openSync(path, flags);
        },
        openDirectory: () => {
          directoryReads += 1;
          throw new Error("duplicate operands must be rejected before recursion");
        },
        readFile: (...arguments_) => {
          fileReads += 1;
          return readSync(...arguments_);
        },
      }),
    ).toThrow(/repeats canonical path operand/i);
    expect({ opens, directoryReads, fileReads }).toEqual({
      opens: 0,
      directoryReads: 0,
      fileReads: 0,
    });
  });

  test("shares the recursive byte and digest-work budget across distinct operands", async () => {
    const root = await repository();
    const executable = join(root, "tools", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const first = join(root, "suite-a"),
      second = join(root, "suite-b");
    await mkdir(first);
    await mkdir(second);
    const firstFile = join(first, "large.test.ts"),
      secondFile = join(second, "large.test.ts");
    await writeFile(firstFile, "");
    await writeFile(secondFile, "");
    await truncate(firstFile, 33 * 1024 * 1024);
    await truncate(secondFile, 33 * 1024 * 1024);
    const opened = new Map<number, string>();
    const reads = new Map<string, number>();

    expect(() =>
      captureGatePathBindings(root, root, ["./tools/verify", "suite-a", "suite-b"], undefined, {
        openPath: (path, flags) => {
          const descriptor = openSync(path, flags);
          opened.set(descriptor, path);
          return descriptor;
        },
        readFile: (descriptor, buffer, offset, length, position) => {
          const path = opened.get(descriptor)!;
          reads.set(path, (reads.get(path) ?? 0) + 1);
          return readSync(descriptor, buffer, offset, length, position);
        },
      }),
    ).toThrow(/shared byte|digest-work/i);
    expect(reads.get(realpathSync(firstFile))).toBeGreaterThan(0);
    expect(reads.get(realpathSync(secondFile)) ?? 0).toBe(0);
  });

  test("protects interpreter programs and configs from every task write scope", async () => {
    const root = await repository();
    await writeFile(join(root, "tools", "verify.ts"), "console.log('ok');\n");
    await writeFile(join(root, "tools", "gate.json"), "{}\n");
    const bindings = captureGatePathBindings(root, root, [
      "bun",
      "tools/verify.ts",
      "--config=tools/gate.json",
    ]);
    expect(bindings.filter(({ scope }) => scope === "repository").map(({ role }) => role)).toEqual([
      "program",
      "config",
    ]);
    expect(
      gateControlBindingsOverlapWriteScopes(bindings, [["src"], ["tools/verify.ts"]]),
    ).toBeTrue();
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src"], ["tests"]])).toBeFalse();
  });

  test("classifies shifted programs and accepted tool config flags as control inputs", async () => {
    const root = await repository();
    const bin = await mkdtemp(join(tmpdir(), "gate-role-bin-"));
    roots.push(bin);
    for (const executable of ["deno", "biome", "prettier", "tsc"])
      await writeFile(join(bin, executable), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await writeFile(join(root, "tools", "verify.ts"), "console.log('ok');\n");
    for (const file of ["biome.json", "ignore.txt", "tsconfig.json"])
      await writeFile(join(root, "tools", file), "{}\n");
    await mkdir(join(root, "src"));

    const commands = [
      ["deno", "run", "--allow-read=src", "tools/verify.ts"],
      ["biome", "check", "--config-path=tools/biome.json", "src"],
      ["prettier", "--check", "--ignore-path", "tools/ignore.txt", "src"],
      ["tsc", "--noEmit", "-p", "tools/tsconfig.json"],
    ];
    const roles = commands.map((argv) =>
      captureGatePathBindings(root, root, argv, bin)
        .filter(({ scope }) => scope === "repository")
        .map(({ relative_path, role }) => [relative_path, role]),
    );
    expect(roles[0]).toContainEqual(["tools/verify.ts", "program"]);
    expect(roles[1]).toContainEqual(["tools/biome.json", "config"]);
    expect(roles[2]).toContainEqual(["tools/ignore.txt", "config"]);
    expect(roles[3]).toContainEqual(["tools/tsconfig.json", "config"]);
  });

  test("does not infer package or tool configuration outside literal argv operands", async () => {
    const root = await repository();
    const cwd = join(root, "packages", "api");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(root, "package.json"), '{"scripts":{"test":"bun test"}}\n');
    await writeFile(join(root, "bunfig.toml"), "[test]\n");
    const argv = ["bun", "run", "test"];
    const bindings = captureGatePathBindings(root, cwd, argv);
    expect(bindings.filter(({ scope }) => scope === "repository")).toEqual([]);
    await writeFile(join(root, "package.json"), '{"scripts":{"test":"false"}}\n');
    expect(gatePathBindingIssues(root, cwd, argv, bindings)).toEqual([]);
  });

  test("rejects capture-to-spawn mutation before invoking the attempt runner", async () => {
    const root = await repository();
    const runRoot = join(root, ".olt", "capsules");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    const executable = join(root, "tools", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    let invoked = false;
    const runner = createInternalCommandRunner({
      ...observer,
      attempt: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./tools/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-test",
    });
    await writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      /identity|digest|changed/i,
    );
    expect(invoked).toBeFalse();
  });
});
