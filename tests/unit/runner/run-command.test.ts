import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  prepareCommand,
  executePreparedCommand,
} from "../../../olt/scripts/src/engine/runner/run-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { resolveScratchDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types.ts";

describe("run-command broad scope test detection and mutex lock", () => {
  test("executePreparedCommand acquires and releases mutex for broad test runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-broad-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => ({}) as PreparedCommand,
      executePreparedCommand: async () => {
        ran = true;
        expect(existsSync(lockFile)).toBe(true);
        expect(readFileSync(lockFile, "utf-8")).toBe(process.pid.toString());
        return { record: { id: "C-1" } } as unknown as CommandResult;
      },
    };

    const prepared: PreparedCommand = {
      commandRoot: "root",
      options: {
        runRoot: repo,
        repositoryRoot: repo,
        argv: ["bun", "test"],
      } as unknown as PreparedCommand["options"],
    };

    await executePreparedCommand(prepared, fakeRunner);
    expect(ran).toBe(true);
    expect(existsSync(lockFile)).toBe(false);
  });

  test("executePreparedCommand bypasses mutex for targeted file-scoped runs", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-targeted-test");
    const lockFile = join(repo, ".olt", ".locks", "execution.lock");

    let ran = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => ({}) as PreparedCommand,
      executePreparedCommand: async () => {
        ran = true;
        expect(existsSync(lockFile)).toBe(false);
        return { record: { id: "C-2" } } as unknown as CommandResult;
      },
    };

    const prepared: PreparedCommand = {
      commandRoot: "root",
      options: {
        runRoot: repo,
        repositoryRoot: repo,
        argv: ["bun", "test", "src/foo.test.ts"],
      } as unknown as PreparedCommand["options"],
    };

    await executePreparedCommand(prepared, fakeRunner);
    expect(ran).toBe(true);
  });

  test("blocks concurrent broad execution when another live process holds lock", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-locked-test");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    // Write parent process pid (which is alive and !== process.pid)
    writeFileSync(join(lockDir, "execution.lock"), process.ppid.toString());

    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => ({}) as PreparedCommand,
      executePreparedCommand: async () => ({}) as CommandResult,
    };

    const prepared: PreparedCommand = {
      commandRoot: "root",
      options: {
        runRoot: repo,
        repositoryRoot: repo,
        argv: ["vitest"],
      } as unknown as PreparedCommand["options"],
    };

    expect(executePreparedCommand(prepared, fakeRunner)).rejects.toThrow(/ENGINE_MUTEX_LOCKED/);
  });

  test("overwrites lock when existing lock belongs to a dead pid", async () => {
    const repo = scratchRoot(import.meta.path, "mutex-dead-pid");
    const lockDir = join(repo, ".olt", ".locks");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "execution.lock"), "999999999");

    let ran = false;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => ({}) as PreparedCommand,
      executePreparedCommand: async () => {
        ran = true;
        return { record: { id: "C-3" } } as unknown as CommandResult;
      },
    };

    const prepared: PreparedCommand = {
      commandRoot: "root",
      options: {
        runRoot: repo,
        repositoryRoot: repo,
        argv: ["pytest"],
      } as unknown as PreparedCommand["options"],
    };

    await executePreparedCommand(prepared, fakeRunner);
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
