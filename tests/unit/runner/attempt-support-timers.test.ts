import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  raceWithTimeout,
  settleBounded,
  settleTrackerBeforeOutcome,
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

  test("a finished command returns the host to an idle event loop", async () => {
    const dir = await scratch("run-command-idle");
    // The drain bound is 5s: a child that has already exited must not hold the loop open for the
    // rest of that budget, or every caller pays the full bound for a command that is already done.
    const elapsed = await exitDelayMs(
      dir,
      `import { executePreparedCommand, prepareCommand } from ${JSON.stringify(RUN_COMMAND)};
const result = await executePreparedCommand(await prepareCommand({
  argv: ["/bin/echo", "hello"],
  cwd: ${JSON.stringify(dir)},
  repositoryRoot: ${JSON.stringify(dir)},
  runRoot: ${JSON.stringify(dir)},
  commandDir: ${JSON.stringify(join(dir, "commands"))},
  actor: "timer-probe",
}));
if (result.record.exit_code !== 0) throw new Error("gate probe did not exit 0");
`,
    );
    expect(elapsed).toBeLessThan(4_000);
  });
});

describe("settleTrackerBeforeOutcome keeps the root-identity binding ahead of the failure path", () => {
  // Regression for run-attempt.ts's `Promise.all([trackerReady, raced])`: Promise.all rejects the
  // instant `raced` rejects, without waiting out a still-pending `trackerReady` — so an
  // output-quota failure could reach cleanup before `attemptIntent.bindRoot` ever bound the root
  // identity, and cleanup then withheld termination for a process it never identified. If this
  // guarantee regresses, `bound` below observes false at the moment the rejection is caught.
  test("waits for a slower trackerReady before surfacing an instant rejection", async () => {
    let bound = false;
    const trackerReady = new Promise<void>((resolve) => {
      setTimeout(() => {
        bound = true;
        resolve();
      }, 20);
    });
    const outcome = Promise.reject(new Error("output quota exceeded"));
    await expect(settleTrackerBeforeOutcome(outcome, trackerReady)).rejects.toThrow(
      "output quota exceeded",
    );
    expect(bound).toBe(true);
  });

  test("swallows the tracker's own rejection so the real failure reason still wins", async () => {
    const trackerReady = Promise.reject(new Error("descendant enumeration failed"));
    await expect(
      settleTrackerBeforeOutcome(Promise.reject(new Error("output quota exceeded")), trackerReady),
    ).rejects.toThrow("output quota exceeded");
  });

  test("returns the outcome's resolved value once the tracker has settled", async () => {
    let bound = false;
    const trackerReady = Promise.resolve().then(() => {
      bound = true;
    });
    expect(
      await settleTrackerBeforeOutcome(Promise.resolve("watchdog-outcome"), trackerReady),
    ).toBe("watchdog-outcome");
    expect(bound).toBe(true);
  });
});
