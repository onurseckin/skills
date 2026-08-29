import { describe, expect, test } from "bun:test";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/models/run-command.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/internal-command-runner.ts";
import {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/capture/runners/types.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `prepareCommand`/`executePreparedCommand` are the production entry points: by default they
// delegate to a runner wired to the real repository inspector and the real attempt spawner, which
// unit tests must not drive directly (that means real git plumbing and a real spawned child).
// The `runner` parameter exists solely so this delegation itself -- forwarding the exact input and
// returning the exact result, nothing more -- can be verified without touching either.

describe("prepareCommand / executePreparedCommand delegation", () => {
  test("prepareCommand forwards its input to the supplied runner unchanged and returns its result", async () => {
    const repo = scratchRoot(import.meta.path, "delegation-prepare");
    const runtimeDir = join(repo, "runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, "agent-implementer-1.json"),
      JSON.stringify({
        agent_id: "implementer-1",
        role: "implementer",
        tier: 3,
        can_execute_shell: true,
        write_scope: ["src/"],
        allowed_read_scope: ["src/"],
        spawned_at: new Date().toISOString(),
      }),
    );

    const seenInputs: CommandOptions[] = [];
    const preparedStub = {
      commandRoot: "stub-root",
      options: { runRoot: repo, repositoryRoot: repo },
    } as unknown as PreparedCommand;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async (input) => {
        seenInputs.push(input);
        return preparedStub;
      },
      executePreparedCommand: async () => {
        throw new Error("must not be called by prepareCommand");
      },
    };
    const input: CommandOptions = {
      argv: ["echo", "hi"],
      cwd: repo,
      repositoryRoot: repo,
      commandDir: join(repo, ".capsules", "commands"),
      actor: "implementer-1",
    };
    const result = await prepareCommand(input, fakeRunner);
    expect(result).toBe(preparedStub);
    expect(seenInputs).toEqual([input]);
  });

  test("executePreparedCommand forwards its prepared command to the supplied runner unchanged", async () => {
    const seenPrepared: PreparedCommand[] = [];
    const resultStub = { record: { id: "C-1" } } as unknown as CommandResult;
    const prepared = {
      commandRoot: "stub-root-2",
      options: { runRoot: "/repo", repositoryRoot: "/repo", argv: ["echo"] },
    } as unknown as PreparedCommand;
    const fakeRunner: InternalCommandRunner = {
      prepareCommand: async () => {
        throw new Error("must not be called by executePreparedCommand");
      },
      executePreparedCommand: async (input) => {
        seenPrepared.push(input);
        return resultStub;
      },
    };
    const result = await executePreparedCommand(prepared, fakeRunner);
    expect(result).toBe(resultStub);
    expect(seenPrepared).toEqual([prepared]);
  });
});
