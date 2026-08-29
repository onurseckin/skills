import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareCommand } from "../../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";
import type { InternalCommandRunner } from "../../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../../olt/scripts/src/engine/runner/types/types.ts";

describe("prepareCommand authorization & RBAC", () => {
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
        can_execute_shell: false,
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
