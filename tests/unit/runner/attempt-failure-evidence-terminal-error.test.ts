import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttemptExecutionError } from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-failure-evidence.ts";
import type { NormalizedCommandOptions } from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createAttemptExecutionError terminal-evidence-failure fallback", () => {
  test("wraps a failure while persisting evidence around the original error's message", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "attempt-failure-evidence-terminal-"));
    roots.push(runRoot);
    const attemptDir = join(runRoot, "attempt-1");
    // The attempt directory exists but none of stdout.log / stderr.log / activity.json were ever
    // written, so writeAttemptFailureEvidence's own read of them fails, forcing the outer
    // catch in createAttemptExecutionError to run.
    await mkdir(attemptDir);
    const options = { runRoot, maxOutputBytes: 1024, argv: ["tool"] } as NormalizedCommandOptions;

    expect(() =>
      createAttemptExecutionError({
        options,
        commandId: "C-1",
        attempt: 1,
        attemptDir,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        exitCode: null,
        signal: null,
        signals: [],
        outputTail: "",
        error: new Error("original attempt failure"),
      }),
    ).toThrow(/^original attempt failure; terminal attempt evidence failed: /);
  });

  test("falls back to String(error) when the original error is not an Error instance", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "attempt-failure-evidence-terminal-nonerror-"));
    roots.push(runRoot);
    const attemptDir = join(runRoot, "attempt-1");
    await mkdir(attemptDir);
    const options = { runRoot, maxOutputBytes: 1024, argv: ["tool"] } as NormalizedCommandOptions;

    expect(() =>
      createAttemptExecutionError({
        options,
        commandId: "C-1",
        attempt: 1,
        attemptDir,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        exitCode: null,
        signal: null,
        signals: [],
        outputTail: "",
        error: "plain string failure",
      }),
    ).toThrow(/^plain string failure; terminal attempt evidence failed: /);
  });
});
