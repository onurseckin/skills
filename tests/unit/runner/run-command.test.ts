import { describe, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { releaseFlock as releaseNativeFlock } from "../../../olt/scripts/src/platform/index.ts";
import {
  prepareCommand,
  executePreparedCommand,
  setExecutionLockDependenciesForTesting,
} from "../../../olt/scripts/src/engine/runner/run-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { resolveScratchDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types.ts";

const runCommandModule = new URL(
  "../../../olt/scripts/src/engine/runner/run-command.ts",
  import.meta.url,
).href;

function broadPrepared(repo: string, argv: readonly string[] = ["bun", "test"]): PreparedCommand {
  return {
    commandRoot: "root",
    options: {
      runRoot: repo,
      repositoryRoot: repo,
      argv,
    } as unknown as PreparedCommand["options"],
  };
}

function broadRunner(onExecute: () => Promise<CommandResult>): InternalCommandRunner {
  return {
    prepareCommand: async () => ({}) as PreparedCommand,
    executePreparedCommand: onExecute,
  };
}

function syntheticStats(kind: "directory" | "file", inode: number): Stats {
  return {
    dev: 1,
    ino: inode,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymbolicLink: () => false,
  } as unknown as Stats;
}

function enoent(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for child lock state");
    await Bun.sleep(10);
  }
}

function childContenderProgram(
  repo: string,
  marker: string,
  release: string,
  crash = false,
): string {
  return `
    import { appendFileSync, existsSync } from "node:fs";
    import { executePreparedCommand } from ${JSON.stringify(runCommandModule)};
    const prepared = {
      commandRoot: "root",
      options: { runRoot: ${JSON.stringify(repo)}, repositoryRoot: ${JSON.stringify(repo)}, argv: ["bun", "test"] },
    };
    const runner = {
      prepareCommand: async () => ({}),
      executePreparedCommand: async () => {
        appendFileSync(${JSON.stringify(marker)}, "entered\\n");
        ${crash ? "process.exit(22);" : `while (!existsSync(${JSON.stringify(release)})) await Bun.sleep(5);`}
        return { record: { id: "child" } };
      },
    };
    try {
      await executePreparedCommand(prepared, runner);
      appendFileSync(${JSON.stringify(marker)}, "success\\n");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
      appendFileSync(${JSON.stringify(marker)}, String(code) + "\\n");
    }
  `;
}

describe("run-command broad scope test detection and inode-bound mutex lock", () => {
  test("keeps a persistent regular lock inode after a broad run releases it", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-broad-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner = broadRunner(async () => {
      ran = true;
      expect(existsSync(lockFile)).toBe(true);
      return { record: { id: "C-1" } } as unknown as CommandResult;
    });

    await executePreparedCommand(broadPrepared(repo), fakeRunner);
    expect(ran).toBe(true);
    expect(lstatSync(lockFile).isFile()).toBe(true);
  });

  test("executePreparedCommand bypasses mutex for targeted file-scoped runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-targeted-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner = broadRunner(async () => {
      ran = true;
      expect(existsSync(lockFile)).toBe(false);
      return { record: { id: "C-2" } } as unknown as CommandResult;
    });

    await executePreparedCommand(
      broadPrepared(repo, ["bun", "test", "src/foo.test.ts"]),
      fakeRunner,
    );
    expect(ran).toBe(true);
  });

  test("treats malformed stale PID text as irrelevant after flock acquisition", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-stale-pid");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "execution.lock"), "not-a-pid", "utf-8");
    let ran = false;

    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        ran = true;
        return { record: { id: "stale" } } as unknown as CommandResult;
      }),
    );
    expect(ran).toBe(true);
  });

  test("refuses a final-component symlink without touching its target or running", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-symlink");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    const target = join(repo, "outside-lock-target");
    writeFileSync(target, "sentinel", "utf-8");
    symlinkSync(target, join(lockDir, "execution.lock"));

    let ran = false;
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          ran = true;
          return { record: { id: "symlink" } } as unknown as CommandResult;
        }),
      ),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(ran).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("sentinel");
  });

  test("fails closed for a wrong-kind lock node and injected unreadable lock open", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-wrong-kind");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");
    mkdirSync(lockFile, { recursive: true });
    let ran = false;
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          ran = true;
          return { record: { id: "wrong-kind" } } as unknown as CommandResult;
        }),
      ),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(ran).toBe(false);

    const unreadableRepo = scratchRoot(import.meta.path, "mutex-unreadable");
    const restore = setExecutionLockDependenciesForTesting({
      openLockFile() {
        const denied = Object.assign(new Error("denied"), { code: "EACCES" });
        throw denied;
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(unreadableRepo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "unreadable" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
  });

  test("releases after runner failure so a later broad run can acquire the same inode", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-runner-failure");
    await expect(
      executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          throw new Error("runner failed");
        }),
      ),
    ).rejects.toThrow("runner failed");
    let laterRan = false;
    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        laterRan = true;
        return { record: { id: "later" } } as unknown as CommandResult;
      }),
    );
    expect(laterRan).toBe(true);
  });

  test("preserves an undefined runner failure when cleanup also fails", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-undefined-runner-failure");
    const restore = setExecutionLockDependenciesForTesting({
      releaseFlock(descriptor) {
        releaseNativeFlock(descriptor);
        throw new Error("release failed");
      },
      close(descriptor) {
        closeSync(descriptor);
        throw new Error("close failed");
      },
    });
    let caught: unknown = Symbol("not-run");
    try {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(async () => {
          throw undefined;
        }),
      );
    } catch (error) {
      caught = error;
    } finally {
      restore();
    }
    expect(caught).toBeUndefined();
  });

  test("surfaces release and close failures even when they throw undefined", async () => {
    for (const failingCleanup of ["release", "close"] as const) {
      const repo = scratchRoot(import.meta.path, `mutex-${failingCleanup}-undefined`);
      let closeAttempts = 0;
      const restore = setExecutionLockDependenciesForTesting({
        releaseFlock(descriptor) {
          releaseNativeFlock(descriptor);
          if (failingCleanup === "release") throw undefined;
        },
        close(descriptor) {
          closeAttempts += 1;
          closeSync(descriptor);
          if (failingCleanup === "close") throw undefined;
        },
      });
      try {
        await expect(
          executePreparedCommand(
            broadPrepared(repo),
            broadRunner(
              async () => ({ record: { id: failingCleanup } }) as unknown as CommandResult,
            ),
          ),
        ).rejects.toMatchObject({ code: "INTEGRITY" });
      } finally {
        restore();
      }
      expect(closeAttempts).toBe(2);
    }
  });

  test("fails closed after lock-directory replacement only after repository authority is held", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-lock-directory-replacement");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const events: string[] = [];
    let lockDirectoryReads = 0;
    const restore = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {
        events.push("mkdir-lock-directory");
      },
      lstat(path) {
        if (path === repo) return syntheticStats("directory", 1);
        if (path === lockFile) throw enoent();
        if (path === lockDir) {
          lockDirectoryReads += 1;
          return syntheticStats("directory", lockDirectoryReads === 1 ? 2 : 3);
        }
        throw new Error(`unexpected lstat path: ${path}`);
      },
      openRepositoryRoot() {
        events.push("open-repository-root");
        return 71;
      },
      openLockFile() {
        events.push("open-lock-file");
        return 72;
      },
      fstat(descriptor) {
        return syntheticStats(descriptor === 71 ? "directory" : "file", descriptor === 71 ? 1 : 72);
      },
      tryExclusiveFlock(descriptor) {
        events.push(`flock-${descriptor}`);
        return true;
      },
      releaseFlock(descriptor) {
        events.push(`release-${descriptor}`);
      },
      close(descriptor) {
        events.push(`close-${descriptor}`);
      },
    });
    let ran = false;
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "replacement" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
    expect(events.indexOf("flock-71")).toBeLessThan(events.indexOf("mkdir-lock-directory"));
    expect(events).toContain("release-71");
    expect(events).toContain("close-72");
    expect(events).toContain("close-71");
  });

  test("identity-binds the opened repository root before touching its lock directory", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-repository-identity-replacement");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const events: string[] = [];
    const restore = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {
        events.push("mkdir-lock-directory");
      },
      lstat(path) {
        if (path === repo) return syntheticStats("directory", 1);
        if (path === lockDir) return syntheticStats("directory", 3);
        if (path === lockFile) throw enoent();
        throw new Error(`unexpected lstat path: ${path}`);
      },
      openRepositoryRoot: () => 101,
      openLockFile: () => 102,
      fstat(descriptor) {
        return syntheticStats(
          descriptor === 101 ? "directory" : "file",
          descriptor === 101 ? 2 : 4,
        );
      },
      tryExclusiveFlock: () => true,
      close(descriptor) {
        events.push(`close-${descriptor}`);
      },
    });
    let ran = false;
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => {
            ran = true;
            return { record: { id: "root-identity" } } as unknown as CommandResult;
          }),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restore();
    }
    expect(ran).toBe(false);
    expect(events).not.toContain("mkdir-lock-directory");
    expect(events).toEqual(["close-101"]);
  });

  test("keeps a same-repository normalized path alias mutually exclusive", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-path-alias");
    let allowFirstToFinish!: () => void;
    const firstMayFinish = new Promise<void>((resolveFirst) => {
      allowFirstToFinish = resolveFirst;
    });
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolveEntered) => {
      enteredFirst = resolveEntered;
    });
    const first = executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        enteredFirst();
        await firstMayFinish;
        return { record: { id: "first" } } as unknown as CommandResult;
      }),
    );
    await firstEntered;
    await expect(
      executePreparedCommand(
        broadPrepared(join(repo, ".")),
        broadRunner(async () => ({ record: { id: "second" } }) as unknown as CommandResult),
      ),
    ).rejects.toMatchObject({ code: "LOCK_TIMEOUT" });
    allowFirstToFinish();
    await first;
  });

  test("cleans every opened descriptor on fstat and flock acquisition errors", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-acquisition-cleanup");
    const lockDir = join(repo, ".olt", ".locks");
    const lockFile = join(lockDir, "execution.lock");
    const lstat = (path: string): Stats => {
      if (path === repo || path === lockDir) return syntheticStats("directory", 1);
      if (path === lockFile) throw enoent();
      throw new Error(`unexpected lstat path: ${path}`);
    };

    const rootCloseCalls: number[] = [];
    const restoreRoot = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {},
      lstat,
      openRepositoryRoot: () => 81,
      fstat() {
        throw new Error("root fstat failed");
      },
      close(descriptor) {
        rootCloseCalls.push(descriptor);
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => ({}) as CommandResult),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restoreRoot();
    }
    expect(rootCloseCalls).toEqual([81]);

    const flockReleaseCalls: number[] = [];
    const flockCloseCalls: number[] = [];
    const restoreFlock = setExecutionLockDependenciesForTesting({
      mkdirLockDirectory() {},
      lstat,
      openRepositoryRoot: () => 91,
      openLockFile: () => 92,
      fstat(descriptor) {
        return syntheticStats(descriptor === 91 ? "directory" : "file", descriptor === 91 ? 1 : 92);
      },
      tryExclusiveFlock(descriptor) {
        if (descriptor === 92) throw new Error("file flock failed");
        return true;
      },
      releaseFlock(descriptor) {
        flockReleaseCalls.push(descriptor);
      },
      close(descriptor) {
        flockCloseCalls.push(descriptor);
      },
    });
    try {
      await expect(
        executePreparedCommand(
          broadPrepared(repo),
          broadRunner(async () => ({}) as CommandResult),
        ),
      ).rejects.toMatchObject({ code: "INTEGRITY" });
    } finally {
      restoreFlock();
    }
    expect(flockReleaseCalls).toEqual([91]);
    expect(flockCloseCalls).toEqual([92, 91]);
  });

  test("does not install process signal listeners during repeated broad runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-listeners");
    const signals = ["exit", "SIGINT", "SIGTERM"] as const;
    const before = signals.map((signal) => process.listenerCount(signal));
    for (let iteration = 0; iteration < 2; iteration += 1) {
      await executePreparedCommand(
        broadPrepared(repo),
        broadRunner(
          async () => ({ record: { id: String(iteration) } }) as unknown as CommandResult,
        ),
      );
    }
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  test("allows only one of two real child contenders to enter a held broad run", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-child-contenders");
    const marker = join(repo, "marker.log");
    const release = join(repo, "release");
    const first = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, release)],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const second = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, release)],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await waitFor(() => existsSync(marker) && readFileSync(marker, "utf-8").includes("entered\n"));
    await waitFor(() => readFileSync(marker, "utf-8").includes("LOCK_TIMEOUT\n"));
    writeFileSync(release, "release", "utf-8");
    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    const events = readFileSync(marker, "utf-8").trim().split("\n");
    expect(events.filter((event) => event === "entered")).toHaveLength(1);
    expect(events.filter((event) => event === "success")).toHaveLength(1);
    expect(events.filter((event) => event === "LOCK_TIMEOUT")).toHaveLength(1);
  });

  test("kernel releases a crash holder's flock for a later broad run", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-crash-release");
    const marker = join(repo, "crash-marker.log");
    const child = Bun.spawn(
      [process.execPath, "--eval", childContenderProgram(repo, marker, join(repo, "unused"), true)],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(22);
    let ran = false;
    await executePreparedCommand(
      broadPrepared(repo),
      broadRunner(async () => {
        ran = true;
        return { record: { id: "after-crash" } } as unknown as CommandResult;
      }),
    );
    expect(ran).toBe(true);
  });
});

describe("prepareCommand policy and authorization", () => {
  test("rejects a timeout-only policy before invoking the runner or emitting a receipt", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-policy-timeout");
    const oltDir = join(repo, ".olt");
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "policy.json"), JSON.stringify({ timeout_ms: 45000 }));
    rmSync(resolveScratchDir(repo), { recursive: true, force: true });
    let prepared = false;

    // Create runtime agent metadata so authorization passes
    const runtimeDir = join(repo, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-test-agent.json"),
      JSON.stringify({
        agent_id: "test-agent",
        role: "implementer",
        tier: 3,
        can_execute_shell: true,
        write_scope: ["src/"],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );

    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => {
        prepared = true;
        return {
          commandRoot: "root",
          options: {
            ...opts,
            runRoot: repo,
            repositoryRoot: repo,
          } as unknown as PreparedCommand["options"],
        };
      },
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const input: CommandOptions = {
      actor: "test-agent",
      argv: ["echo", "hello"],
      cwd: repo,
      repositoryRoot: repo,
      runRoot: repo,
      commandDir: join(repo, ".capsules", "commands"),
    };

    await expect(prepareCommand(input, fakeRunner)).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(prepared).toBe(false);
    const evidenceDir = join(resolveScratchDir(repo), "evidence");
    expect(existsSync(evidenceDir)).toBe(false);
  });

  test("rejects malformed policies before invoking the runner or emitting a receipt", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-policy-malformed");
    mkdirSync(join(repo, ".olt"), { recursive: true });
    writeFileSync(join(repo, ".olt", "policy.json"), "{ not-json");
    rmSync(resolveScratchDir(repo), { recursive: true, force: true });
    let prepared = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => {
        prepared = true;
        return {} as PreparedCommand;
      },
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    await expect(
      prepareCommand(
        {
          actor: "malformed-agent",
          argv: ["echo", "hello"],
          cwd: repo,
          repositoryRoot: repo,
          runRoot: repo,
          commandDir: join(repo, ".capsules", "commands"),
        },
        fakeRunner,
      ),
    ).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(prepared).toBe(false);
    expect(existsSync(join(resolveScratchDir(repo), "evidence"))).toBe(false);
  });

  test("uses the target repository policy for RBAC after safe runner preparation", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-target-policy");
    mkdirSync(join(repo, ".olt"), { recursive: true });
    writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({ forbidden_commands: ["echo"] }),
    );
    rmSync(resolveScratchDir(repo), { recursive: true, force: true });
    const runtimeDir = join(repo, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-target-policy-agent.json"),
      JSON.stringify({
        agent_id: "target-policy-agent",
        role: "implementer",
        tier: 3,
        can_execute_shell: true,
        write_scope: ["src/"],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );
    let prepared = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => {
        prepared = true;
        return {
          commandRoot: "root",
          options: { ...opts, runRoot: repo, repositoryRoot: repo } as PreparedCommand["options"],
        };
      },
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    await expect(
      prepareCommand(
        {
          actor: "target-policy-agent",
          argv: ["echo", "hello"],
          cwd: repo,
          repositoryRoot: repo,
          runRoot: repo,
          commandDir: join(repo, ".capsules", "commands"),
        },
        fakeRunner,
      ),
    ).rejects.toThrow(/authorization failed|forbidden|prohibited/i);
    expect(prepared).toBe(true);
    expect(existsSync(join(resolveScratchDir(repo), "evidence"))).toBe(false);
  });

  test("uses the normalized prepared runRoot for metadata when input omits runRoot", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-omitted-run-root");
    const normalizedRunRoot = join(repo, ".olt", "capsules", "run-1");
    const commandDir = join(normalizedRunRoot, "commands");
    const runtimeDir = join(normalizedRunRoot, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-normalized-run-agent.json"),
      JSON.stringify({
        agent_id: "normalized-run-agent",
        role: "implementer",
        tier: 3,
        can_execute_shell: true,
        write_scope: ["src/"],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );
    let prepared = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => {
        prepared = true;
        return {
          commandRoot: "root",
          options: {
            ...opts,
            runRoot: normalizedRunRoot,
            repositoryRoot: repo,
          } as PreparedCommand["options"],
        };
      },
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const preparedCommand = await prepareCommand(
      {
        actor: "normalized-run-agent",
        argv: ["echo", "hello"],
        cwd: repo,
        repositoryRoot: repo,
        commandDir,
      },
      fakeRunner,
    );
    expect(prepared).toBe(true);
    expect(preparedCommand.options.runRoot).toBe(normalizedRunRoot);
  });

  test("keeps an explicit wall timeout while an absent policy uses canonical defaults", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-policy-default");
    const runtimeDir = join(repo, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-default-policy-agent.json"),
      JSON.stringify({
        agent_id: "default-policy-agent",
        role: "implementer",
        tier: 3,
        can_execute_shell: true,
        write_scope: ["src/"],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => ({
        commandRoot: "root",
        options: { ...opts, runRoot: repo, repositoryRoot: repo } as PreparedCommand["options"],
      }),
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const prepared = await prepareCommand(
      {
        actor: "default-policy-agent",
        argv: ["echo", "hello"],
        cwd: repo,
        repositoryRoot: repo,
        runRoot: repo,
        commandDir: join(repo, ".capsules", "commands"),
        wallTimeoutMs: 45_000,
      },
      fakeRunner,
    );
    expect(prepared.options.wallTimeoutMs).toBe(45_000);
  });

  test("throws ROLE_BOUNDARY_VIOLATION when actor metadata is missing", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-missing-actor");
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => ({
        commandRoot: "root",
        options: {
          ...opts,
          runRoot: repo,
          repositoryRoot: repo,
        } as unknown as PreparedCommand["options"],
      }),
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const input: CommandOptions = {
      actor: "nonexistent-actor",
      argv: ["echo", "hello"],
      cwd: repo,
      repositoryRoot: repo,
      commandDir: join(repo, ".capsules", "commands"),
    };

    expect(prepareCommand(input, fakeRunner)).rejects.toThrow(/ROLE_BOUNDARY_VIOLATION/);
  });

  test("throws when command is not authorized by RBAC policy", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-unauthorized");
    const runtimeDir = join(repo, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-unauthorized-agent.json"),
      JSON.stringify({
        agent_id: "unauthorized-agent",
        role: "validator",
        tier: 3,
        can_execute_shell: false, // validator has zero shell permissions!
        write_scope: [],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );

    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (opts) => ({
        commandRoot: "root",
        options: {
          ...opts,
          runRoot: repo,
          repositoryRoot: repo,
        } as unknown as PreparedCommand["options"],
      }),
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const input: CommandOptions = {
      actor: "unauthorized-agent",
      argv: ["echo", "hello"],
      cwd: repo,
      repositoryRoot: repo,
      commandDir: join(repo, ".capsules", "commands"),
    };

    expect(prepareCommand(input, fakeRunner)).rejects.toThrow(
      /COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN|Command authorization failed|UNAUTHORIZED/,
    );
  });
});
