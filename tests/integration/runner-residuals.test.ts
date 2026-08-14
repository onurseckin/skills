import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  reconcileCommandResult,
  recordCommandIntent,
  recordCommandResult,
} from "../../orchestrating-long-tasks/scripts/src/integration/record-command.ts";
import { executePreparedCommand, prepareCommand } from "../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import { initRun, loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function prepared() {
  const repo = await mkdtemp(join(tmpdir(), "runner-residual-"));
  roots.push(repo);
  const runRoot = initRun(repo, "runner", new TextEncoder().encode("prompt"), "file", true);
  const command = await prepareCommand({
    argv: [process.execPath, "--eval", "console.log('ok')"],
    cwd: repo,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
  });
  return { runRoot, command };
}

describe("runner durable identity residuals", () => {
  test("event actor must equal the command actor", async () => {
    const { runRoot, command } = await prepared();
    expect(() => recordCommandIntent(runRoot, "attacker", command.record)).toThrow(/actor/i);
    recordCommandIntent(runRoot, "validator", command.record);
    const result = await executePreparedCommand(command);
    expect(() => reconcileCommandResult(runRoot, "attacker", result.record)).toThrow(/actor/i);
  });

  test("terminal insertion requires its previously persisted running intent", async () => {
    const { runRoot, command } = await prepared();
    const result = await executePreparedCommand(command);
    expect(() => recordCommandResult(runRoot, "validator", result.record)).toThrow(/intent/i);
    expect(loadRun(runRoot).state.commands).toBeUndefined();
  });
});
