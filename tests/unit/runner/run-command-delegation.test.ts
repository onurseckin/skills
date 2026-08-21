import { describe, expect, test } from "bun:test";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import type { InternalCommandRunner } from "../../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

// `prepareCommand`/`executePreparedCommand` are the production entry points: by default they
// delegate to a runner wired to the real repository inspector and the real attempt spawner, which
// unit tests must not drive directly (that means real git plumbing and a real spawned child).
// The `runner` parameter exists solely so this delegation itself -- forwarding the exact input and
// returning the exact result, nothing more -- can be verified without touching either.

describe("prepareCommand / executePreparedCommand delegation", () => {
  test("prepareCommand forwards its input to the supplied runner unchanged and returns its result", async () => {
    const seenInputs: CommandOptions[] = [];
    const preparedStub = { commandRoot: "stub-root" } as unknown as PreparedCommand;
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
      cwd: "/repo",
      commandDir: "/repo/.capsules/commands",
      actor: "validator",
    };
    const result = await prepareCommand(input, fakeRunner);
    expect(result).toBe(preparedStub);
    expect(seenInputs).toEqual([input]);
  });

  test("executePreparedCommand forwards its prepared command to the supplied runner unchanged", async () => {
    const seenPrepared: PreparedCommand[] = [];
    const resultStub = { record: { id: "C-1" } } as unknown as CommandResult;
    const prepared = { commandRoot: "stub-root-2" } as unknown as PreparedCommand;
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
