import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  raceWithTimeout,
  settleBounded,
} from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-support.ts";

const SUPPORT = join(
  import.meta.dir,
  "../../../orchestrating-long-tasks/scripts/src/runner/attempt-support.ts",
);
const RUN_COMMAND = join(
  import.meta.dir,
  "../../../orchestrating-long-tasks/scripts/src/runner/run-command.ts",
);

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function scratch(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(dir);
  return dir;
}

/** Wall time from spawn to exit. A bound left armed keeps the event loop alive, so the child lingers
 *  for the bound's full duration even though its work finished immediately. */
async function exitDelayMs(dir: string, source: string): Promise<number> {
  const script = join(dir, "probe.ts");
  await writeFile(script, source);
  const started = Date.now();
  const child = Bun.spawn({ cmd: ["bun", script], stdout: "pipe", stderr: "pipe" });
  const exitCode = await child.exited;
  const elapsed = Date.now() - started;
  expect({ exitCode, stderr: await new Response(child.stderr).text() }).toEqual({
    exitCode: 0,
    stderr: "",
  });
  return elapsed;
}

describe("attempt bounds release the event loop when the work wins", () => {
  test("settleBounded reports settlement and enforces its bound", async () => {
    expect(await settleBounded([Promise.resolve()], 60_000)).toBeTrue();
    expect(await settleBounded([new Promise(() => undefined)], 1)).toBeFalse();
  });

  test("raceWithTimeout returns the work's value and rejects when the bound wins", async () => {
    expect(await raceWithTimeout(Promise.resolve("done"), 60_000, "unused")).toBe("done");
    await expect(raceWithTimeout(new Promise(() => undefined), 1, "drain timeout")).rejects.toThrow(
      "drain timeout",
    );
  });

  test("a won race leaves no armed timer behind", async () => {
    const dir = await scratch("attempt-bound-timers");
    const elapsed = await exitDelayMs(
      dir,
      `import { raceWithTimeout, settleBounded } from ${JSON.stringify(SUPPORT)};
await settleBounded([Promise.resolve()], 30_000);
await raceWithTimeout(Promise.resolve(1), 30_000, "unused");
`,
    );
    expect(elapsed).toBeLessThan(5_000);
  });

  test("runCommand returns the host to an idle event loop once the child has exited", async () => {
    const dir = await scratch("run-command-idle");
    // The drain bound defaults to 5s; before the fix this child idled for that full budget after the
    // echo had already exited, which is what timed out a 5s integration test.
    const elapsed = await exitDelayMs(
      dir,
      `import { runCommand } from ${JSON.stringify(RUN_COMMAND)};
const result = await runCommand({
  argv: ["/bin/echo", "hello"],
  cwd: ${JSON.stringify(dir)},
  repositoryRoot: ${JSON.stringify(dir)},
  runRoot: ${JSON.stringify(dir)},
  commandDir: ${JSON.stringify(join(dir, "commands"))},
  actor: "timer-probe",
});
if (result.record.exit_code !== 0) throw new Error("gate probe did not exit 0");
`,
    );
    expect(elapsed).toBeLessThan(4_000);
  });
});
