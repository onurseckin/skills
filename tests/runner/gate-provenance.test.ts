import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommandAttemptRecord } from "../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { RepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import { OWNERSHIP_ENV } from "../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import { captureGatePathBindings } from "../../orchestrating-long-tasks/scripts/src/runner/gate-path-bindings.ts";
import { createInternalCommandRunner } from "../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import type { AttemptResult, NormalizedCommandOptions } from "../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const roots: string[] = [];
const repositoryBinding: RepositoryBinding = {
  schema: "harness.repository-binding",
  version: 1,
  inspection_sha256: "a".repeat(64),
  git_identity_sha256: "b".repeat(64),
  content_sha256: "c".repeat(64),
  file_count: 1,
  total_bytes: 17,
};
const observer = { inspectRepository: () => repositoryBinding };

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "gate-provenance-"));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, ".capsules", "commands"), { recursive: true });
  return root;
}

async function tools(root: string, names: readonly string[]): Promise<string> {
  for (const name of names) {
    const path = join(root, "bin", name);
    await writeFile(path, "#!/bin/sh\nexit 0\n");
    await chmod(path, 0o700);
  }
  return join(root, "bin");
}

function success(id: string, attempt = 1): AttemptResult {
  const empty = { path: "empty", bytes: 0, sha256: "e".repeat(64) };
  const record: CommandAttemptRecord = {
    id,
    attempt,
    status: "succeeded",
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: null,
    activity_path: "empty",
    activity: empty,
    logs: { stdout: empty, stderr: empty },
  };
  return {
    record,
    attempt,
    stdoutPath: "empty",
    stderrPath: "empty",
    activityPath: "empty",
    outputTail: "",
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("gate trusted-host provenance", () => {
  test("binds only literal executable, script, config, and target operands", async () => {
    const root = await repository();
    const bin = await tools(root, ["bun"]);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "check.ts"), "export {};\n");
    await writeFile(join(root, "bunfig.toml"), "[test]\n");
    const bindings = captureGatePathBindings(
      root,
      root,
      ["bun", "test", "src/check.ts", "--config=bunfig.toml"],
      bin,
    );
    expect(
      bindings.map(({ argv_index, relative_path, role }) => [argv_index, relative_path, role]),
    ).toEqual([
      [0, undefined, "executable"],
      [2, "src/check.ts", "target"],
      [3, "bunfig.toml", "config"],
    ]);
  });

  test("executes with the recorded safe environment and excludes injection variables", async () => {
    const root = await repository();
    const executable = join(root, "bin", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousPythonPath = process.env.PYTHONPATH;
    const previousNodePath = process.env.NODE_PATH;
    process.env.NODE_OPTIONS = "--require=/tmp/inject.js";
    process.env.PYTHONPATH = "/tmp/inject";
    process.env.NODE_PATH = "/tmp/plugins";
    try {
      let executed: NormalizedCommandOptions | undefined;
      const runner = createInternalCommandRunner({
        ...observer,
        attempt: async (options, attempt, id) => {
          executed = options;
          return success(id, attempt);
        },
      });
      const prepared = await runner.prepareCommand({
        argv: ["./bin/verify"],
        cwd: root,
        runRoot: join(root, ".capsules"),
        commandDir: join(root, ".capsules", "commands"),
        actor: "validator",
        gateId: "G-env",
      });
      await runner.executePreparedCommand(prepared);
      expect(prepared.record.environment).toEqual(executed!.environment);
      expect(prepared.record.environment?.NODE_OPTIONS).toBeUndefined();
      expect(prepared.record.environment?.PYTHONPATH).toBeUndefined();
      expect(prepared.record.environment?.NODE_PATH).toBeUndefined();
      expect(prepared.record.environment).toMatchObject({
        GOENV: "off",
        NPM_CONFIG_USERCONFIG: "/dev/null",
        PYTHONNOUSERSITE: "1",
        PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
      });
      expect(prepared.record.environment?.[OWNERSHIP_ENV]).toMatch(/^[0-9a-f-]{36}$/u);
      expect(executed!.argv[0]).toBe(realpathSync(executable));
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previousPythonPath;
      if (previousNodePath === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = previousNodePath;
    }
  });

  test("persists a terminal integrity failure when a control changes during an attempt", async () => {
    const root = await repository();
    const executable = join(root, "bin", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const runner = createInternalCommandRunner({
      ...observer,
      attempt: async (_options, attempt, id) => {
        await writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
        return success(id, attempt);
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".capsules"),
      commandDir: join(root, ".capsules", "commands"),
      actor: "validator",
      gateId: "G-race",
    });
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      /post-attempt|identity|digest|changed/i,
    );
    const stored = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(stored.status).toBe("failed");
    expect(stored.evidence_error).toMatch(/post-attempt|identity|digest|changed/i);
  });

  test("does not execute from caller-mutated bindings or environment", async () => {
    const root = await repository();
    const executable = join(root, "bin", "verify");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    let invoked = false;
    const runner = createInternalCommandRunner({
      ...observer,
      attempt: async (_options, attempt, id) => {
        invoked = true;
        return success(id, attempt);
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".capsules"),
      commandDir: join(root, ".capsules", "commands"),
      actor: "validator",
      gateId: "G-intent",
    });
    await writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    prepared.record.path_bindings = captureGatePathBindings(root, root, ["./bin/verify"]);
    prepared.record.environment!.LANG = "caller-mutated";
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(/durable|intent|record/i);
    expect(invoked).toBeFalse();
  });
});
