import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordCommandIntent,
  runAndRecordCommand,
} from "../../orchestrating-long-tasks/scripts/src/integration/record-command.ts";
import { prepareCommand } from "../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stranded command launch guard", () => {
  test("refuses a new launch while prior running intent lacks terminal evidence", async () => {
    const repo = await mkdtemp(join(tmpdir(), "stranded-command-"));
    roots.push(repo);
    const runRoot = initRun(repo, "stranded", new TextEncoder().encode("prompt"), "file", true);
    const prior = await prepareCommand({
      argv: [process.execPath, "--eval", "console.log('prior')"],
      cwd: repo,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    recordCommandIntent(runRoot, "validator", prior.record);

    const runtime = Bun as unknown as { spawn: typeof Bun.spawn };
    const original = runtime.spawn;
    let spawned = false;
    runtime.spawn = (() => {
      spawned = true;
      throw new Error("unexpected spawn");
    }) as typeof Bun.spawn;
    try {
      await expect(
        runAndRecordCommand(runRoot, {
          argv: [process.execPath, "--eval", "console.log('new')"],
          cwd: repo,
          commandDir: join(runRoot, "commands"),
          actor: "validator",
        }),
      ).rejects.toThrow(/stranded|running command|terminal evidence/i);
      expect(spawned).toBeFalse();
    } finally {
      runtime.spawn = original;
    }
  });
});
