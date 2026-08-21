import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { planInitCommand } from "../../orchestrating-long-tasks/scripts/src/cli/commands/plan.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-pin-"));
  roots.push(root);
  const path = join(root, "repo");
  mkdirSync(path);
  return path;
}

/** A minimal stand-in for the harness source tree copyPinnedRuntime is meant to pin. */
function runtimeSource(): string {
  const root = mkdtempSync(join(tmpdir(), "runtime-pin-source-"));
  roots.push(root);
  writeFileSync(join(root, "harness.ts"), "// entry point\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.ts"), "export {};\n");
  return root;
}

describe("plan:init pins the runtime that is executing it", () => {
  test("a run started without a runtime source records no pin at all", () => {
    const run = initRun(repo(), "run-unpinned", new TextEncoder().encode("prompt\n"), "file", true);

    expect(existsSync(join(run, "runtime"))).toBeFalse();
    const manifest = loadRun(run).manifest;
    expect(manifest.runtime_sha256).toBeUndefined();
    expect(manifest.runtime_files).toBeUndefined();
    expect(manifest.runtime_entrypoint).toBeUndefined();
  });

  test("a run started with a runtime source carries a verified, readable copy of it", () => {
    const source = runtimeSource();
    const run = initRun(repo(), "run-pinned", new TextEncoder().encode("prompt\n"), "file", true, {
      runtimeSource: source,
    });

    expect(readFileSync(join(run, "runtime", "harness.ts"), "utf-8")).toBe("// entry point\n");
    expect(readFileSync(join(run, "runtime", "src", "index.ts"), "utf-8")).toBe("export {};\n");

    const manifest = loadRun(run).manifest;
    expect(manifest.runtime_entrypoint).toBe("runtime/harness.ts");
    expect(manifest.runtime_files).toBe(2);
    expect(manifest.runtime_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a runtime source with no harness.ts pins the tree but reports no entrypoint", () => {
    const root = mkdtempSync(join(tmpdir(), "runtime-pin-source-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "index.ts"), "export {};\n");

    const run = initRun(
      repo(),
      "run-pinned-no-entry",
      new TextEncoder().encode("prompt\n"),
      "file",
      true,
      { runtimeSource: root },
    );

    const manifest = loadRun(run).manifest;
    expect(manifest.runtime_files).toBe(1);
    expect(manifest.runtime_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.runtime_entrypoint).toBeUndefined();
  });

  test("a source that changes mid-copy fails the run rather than pinning a torn snapshot", () => {
    const source = runtimeSource();
    expect(() =>
      initRun(repo(), "run-torn", new TextEncoder().encode("prompt\n"), "file", true, {
        runtimeSource: source,
        beforeRuntimeSourceRecheck: () => {
          writeFileSync(join(source, "harness.ts"), "// mutated after the copy started\n");
        },
      }),
    ).toThrow("runtime source changed while it was being copied");
  });
});

describe("plan:init CLI wiring chooses the runtime source", () => {
  test("defaults to the running harness when the host reports one", async () => {
    const source = runtimeSource();
    const result = await planInitCommand(
      { run: "run-default-pin", repo: repo(), "prompt-stdin": true },
      { stdin: new TextEncoder().encode("prompt\n"), executingRuntime: source },
    );
    const manifest = loadRun(result.run_root as string).manifest;
    expect(manifest.runtime_entrypoint).toBe("runtime/harness.ts");
  });

  test("an explicit --runtime-source overrides the host default", async () => {
    const hostReported = runtimeSource();
    const explicit = runtimeSource();
    writeFileSync(join(explicit, "package.json"), "{}\n");
    const result = await planInitCommand(
      {
        run: "run-explicit-pin",
        repo: repo(),
        "prompt-stdin": true,
        "runtime-source": explicit,
      },
      { stdin: new TextEncoder().encode("prompt\n"), executingRuntime: hostReported },
    );
    const manifest = loadRun(result.run_root as string).manifest;
    expect(manifest.runtime_files).toBe(3);
  });

  test("--no-runtime-pin refuses the host default", async () => {
    const source = runtimeSource();
    const result = await planInitCommand(
      { run: "run-refused-pin", repo: repo(), "prompt-stdin": true, "no-runtime-pin": true },
      { stdin: new TextEncoder().encode("prompt\n"), executingRuntime: source },
    );
    const manifest = loadRun(result.run_root as string).manifest;
    expect(manifest.runtime_sha256).toBeUndefined();
    expect(existsSync(join(result.run_root as string, "runtime"))).toBeFalse();
  });
});
