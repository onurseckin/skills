import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveScratchDir } from "../../../olt/scripts/src/core/shared/paths.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { prepareCommand } from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupTempRoots, getRunnerVfs, tempRoot } from "./fixture.ts";

afterAll(cleanupTempRoots);

describe("prepareCommand policy and authorization", () => {
  test("rejects a timeout-only policy before invoking the runner or emitting a receipt", async () => {
    const repo = tempRoot("prepare-policy-timeout");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    const oltDir = join(repo, ".olt");
    vfs.mkdirSync(oltDir, { recursive: true });
    vfs.writeFileSync(join(oltDir, "policy.json"), JSON.stringify({ timeout_ms: 45000 }));
    vfs.rmSync(resolveScratchDir(repo), { recursive: true, force: true });
    let prepared = false;

    const runtimeDir = join(repo, "runtime");
    vfs.mkdirSync(runtimeDir, { recursive: true });
    vfs.writeFileSync(
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
    expect(vfs.existsSync(evidenceDir)).toBe(false);
  });

  test("rejects malformed policies before invoking the runner or emitting a receipt", async () => {
    const repo = tempRoot("prepare-policy-malformed");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
    vfs.writeFileSync(join(repo, ".olt", "policy.json"), "{ not-json");
    vfs.rmSync(resolveScratchDir(repo), { recursive: true, force: true });
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
    expect(vfs.existsSync(join(resolveScratchDir(repo), "evidence"))).toBe(false);
  });

  test("uses the target repository policy for RBAC after safe runner preparation", async () => {
    const repo = tempRoot("prepare-target-policy");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
    vfs.writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({
        schema_version: 1,
        ecosystem: "bun",
        forbidden_commands: ["echo"],
        test_runner: {
          default_command: "bun test",
          targeted_pattern: "bun test <path>",
          full_suite_command: "bun test",
        },
      }),
    );
    vfs.rmSync(resolveScratchDir(repo), { recursive: true, force: true });
    const runtimeDir = join(repo, "runtime");
    vfs.mkdirSync(runtimeDir, { recursive: true });
    vfs.writeFileSync(
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
    expect(vfs.existsSync(join(resolveScratchDir(repo), "evidence"))).toBe(false);
  });

  test("uses the normalized prepared runRoot for metadata when input omits runRoot", async () => {
    const repo = tempRoot("prepare-omitted-run-root");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    const normalizedRunRoot = join(repo, ".olt", "capsules", "run-1");
    const commandDir = join(normalizedRunRoot, "commands");
    const runtimeDir = join(normalizedRunRoot, "runtime");
    vfs.mkdirSync(runtimeDir, { recursive: true });
    vfs.writeFileSync(
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
    const repo = tempRoot("prepare-policy-default");
    const vfs: VirtualMemoryFS = getRunnerVfs();
    const runtimeDir = join(repo, "runtime");
    vfs.mkdirSync(runtimeDir, { recursive: true });
    vfs.writeFileSync(
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
});
