import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/models/execution/run-command.ts";
import type { InternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import type {
  CommandOptions,
  CommandResult,
  PreparedCommand,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { getRunnerVfs, tempRoot, cleanupTempRoots, writeTree } from "./fixture.ts";

afterEach(cleanupTempRoots);

describe("prepareCommand / executePreparedCommand delegation", () => {
  test("prepareCommand forwards its input to the supplied runner unchanged and returns its result", async () => {
    const repo = tempRoot("delegation-prepare");
    const vfs = getRunnerVfs();
    const runtimeDir = join(repo, "runtime");
    vfs.mkdirSync(runtimeDir, { recursive: true });
    vfs.writeFileSync(
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

  test("fixture writeTree creates nested files and directories", () => {
    const root = tempRoot("fixture-tree");
    const res = writeTree(root, { "nested/deep/file.txt": "hello" });
    expect(res).toBe(root);
  });
});
