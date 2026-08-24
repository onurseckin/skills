import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareCommand,
  executePreparedCommand,
} from "../../../olt/scripts/src/engine/runner/run-command.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
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
  test("reads policy.json timeout_ms and applies to wallTimeoutMs", async () => {
    const repo = scratchRoot(import.meta.path, "prepare-policy-timeout");
    const oltDir = join(repo, ".olt");
    mkdirSync(oltDir, { recursive: true });
    writeFileSync(join(oltDir, "policy.json"), JSON.stringify({ timeout_ms: 45000 }));

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
        expect(opts.wallTimeoutMs).toBe(45000);
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
      commandDir: join(repo, ".capsules", "commands"),
    };

    const prepared = await prepareCommand(input, fakeRunner);
    expect(prepared).toBeDefined();

    // Verify evidence receipt was created in scratch evidence directory
    const { resolveScratchDir } = await import("../../../olt/scripts/src/core/shared/paths.ts");
    const evidenceDir = join(resolveScratchDir(repo), "evidence");
    expect(existsSync(evidenceDir)).toBe(true);
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
