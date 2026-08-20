import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { declaredToolFlags } from "../../../orchestrating-long-tasks/scripts/src/cli/taxonomy-flags.ts";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function capsule(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-declared-tool-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Run the suite.\n");
  await writeFile(join(repo, "gate.ts"), "console.log('ok');\n");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

function recordedCommands(run: string): CommandRecord[] {
  const state = loadRun(run).state as { commands?: Record<string, CommandRecord> };
  return Object.values(state.commands ?? {});
}

describe("declaring what a command was", () => {
  test("run:exec records the category, the tool and the extras on the command", async () => {
    const { repo, run } = await capsule("declared");
    await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "validator-1",
      "--cwd",
      repo,
      "--tool-category",
      "test-runner",
      "--tool",
      "the-suite",
      "--tool-extra",
      "shard=2/4",
      "--",
      "bun",
      "gate.ts",
    ]);

    const [record] = recordedCommands(run);
    expect(record?.tool_category).toBe("test-runner");
    expect(record?.tool).toBe("the-suite");
    expect(record?.tool_extras).toEqual({ shard: "2/4" });
  });

  test("a command run without the flags records nothing about a tool", async () => {
    const { repo, run } = await capsule("undeclared");
    await execute([
      "run:exec",
      "--run",
      run,
      "--actor",
      "validator-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate.ts",
    ]);

    const [record] = recordedCommands(run);
    expect("tool_category" in (record ?? {})).toBeFalse();
    expect("tool" in (record ?? {})).toBeFalse();
    expect("tool_extras" in (record ?? {})).toBeFalse();
  });
});

describe("what the command's tool flags accept and refuse", () => {
  test("reads a category on its own, a tool on its own, and both together", () => {
    expect(declaredToolFlags({})).toEqual({});
    expect(declaredToolFlags({ "tool-category": "linter" })).toEqual({ toolCategory: "linter" });
    expect(declaredToolFlags({ tool: "the-linter" })).toEqual({ tool: "the-linter" });
    expect(
      declaredToolFlags({
        tool: "the-linter",
        "tool-category": "linter",
        "tool-extra": "fix=true",
      }),
    ).toEqual({ tool: "the-linter", toolCategory: "linter", toolExtras: { fix: "true" } });
  });

  test("keeps everything after the first equals sign as the value", () => {
    expect(declaredToolFlags({ tool: "t", "tool-extra": "filter=a=b" })).toEqual({
      tool: "t",
      toolExtras: { filter: "a=b" },
    });
  });

  test("refuses an extra that is not <key>=<value>", () => {
    expect(() => declaredToolFlags({ tool: "t", "tool-extra": "shard" })).toThrow(
      "--tool-extra expects <key>=<value>",
    );
    expect(() => declaredToolFlags({ tool: "t", "tool-extra": "=2" })).toThrow(
      "--tool-extra expects <key>=<value>",
    );
  });

  test("refuses the same key twice, because one of the two would be lost silently", () => {
    expect(() => declaredToolFlags({ tool: "t", "tool-extra": ["shard=1", "shard=2"] })).toThrow(
      "names shard twice",
    );
  });

  test("refuses an extra with no tool to describe", () => {
    expect(() => declaredToolFlags({ "tool-extra": "shard=2" })).toThrow(
      "--tool-extra describes a tool, so --tool is required",
    );
  });
});
