import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { runAttempt } from "../../../olt/scripts/src/engine/runner/models/attempt/run-attempt.ts";
import type {
  BunSpawnApi,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";

// These drive the real `runAttempt` orchestration end to end through the `spawnApi` injection
// seam rather than the global `Bun.spawn`: the returned pid never corresponds to a real OS
// process, so `DescendantTracker` genuinely (not stubbed) walks a live `ps` snapshot, fails to
// find it, and takes its own real "child already gone" degrade path -- exactly the race the
// production code defends against. Streams are real Web Streams with synthetic data; no
// subprocess is ever spawned.

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function neverExited(): Promise<number> {
  return new Promise<number>(() => undefined);
}

import { scratchRoot } from "../../../support/scratch-root.ts";

function attemptRoot(label: string): { root: string; commandRoot: string } {
  const root = scratchRoot(import.meta.path, label);
  const commandRoot = join(root, "commands", "C-1");
  mkdirSync(commandRoot, { recursive: true });
  return { root, commandRoot };
}

function baseOptions(root: string, overrides: Partial<NormalizedCommandOptions> = {}) {
  const ownershipToken = "12345678-1234-4234-8234-123456789abc";
  return {
    argv: ["fake"],
    cwd: root,
    repositoryRoot: root,
    commandDir: join(root, "commands"),
    runRoot: root,
    actor: "validator",
    wallTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    graceMs: 10,
    drainTimeoutMs: 200,
    heartbeatIntervalMs: 5000,
    maxOutputBytes: 1024,
    retries: 0,
    idempotent: false,
    environment: { [OWNERSHIP_ENV]: ownershipToken },
    ...overrides,
  } as NormalizedCommandOptions;
}

describe("runAttempt via an injected spawnApi (no real subprocess)", () => {
  test("finalizes a successful attempt end to end once the child exits", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-success-");
    const options = baseOptions(root);
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_999,
        exited: Promise.resolve(0),
        signalCode: null,
        stdout: textStream(["hello\n"]),
        stderr: textStream([]),
      }),
    };
    const result = await runAttempt(
      options,
      1,
      "C-1",
      commandRoot,
      createCommandSigningCapability(),
      spawnApi,
    );
    expect(result.record.status).toBe("succeeded");
    expect(result.record.exit_code).toBe(0);
    expect(result.record.signals_sent).toEqual([]);
    expect(result.outputTail).toBe("hello\n");
    expect(result.record.logs.stdout.bytes).toBe(6);
    const started = JSON.parse(
      await readFile(join(commandRoot, "attempt-1", "attempt-started.json"), "utf8"),
    );
    // The tracker's own real ps-snapshot lookup for a pid that does not exist resolves to no
    // identity, so the started marker is durably bound with a null root rather than a real one.
    expect(started.root_pid_identity).toBeNull();
  }, 10_000);

  test("fails with a residual-pid error when the wall timeout fires and root identity never bound", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-timeout-");
    const options = baseOptions(root, { wallTimeoutMs: 25, idleTimeoutMs: 5000, graceMs: 10 });
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_998,
        exited: neverExited(),
        signalCode: null,
        stdout: textStream([]),
        stderr: textStream([]),
      }),
    };
    await expect(
      runAttempt(options, 1, "C-1", commandRoot, createCommandSigningCapability(), spawnApi),
    ).rejects.toThrow(/termination withheld|residual pid/i);
  }, 10_000);

  test("surfaces an output-quota failure raised while the attempt is still running", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-quota-");
    const options = baseOptions(root, {
      maxOutputBytes: 1,
      wallTimeoutMs: 5000,
      idleTimeoutMs: 5000,
    });
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_997,
        exited: neverExited(),
        signalCode: null,
        stdout: textStream(["hello\n"]),
        stderr: textStream([]),
      }),
    };
    await expect(
      runAttempt(options, 1, "C-1", commandRoot, createCommandSigningCapability(), spawnApi),
    ).rejects.toThrow("combined command output quota exceeded");
  }, 10_000);

  test("throws when command ownership token is missing from environment", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-no-token-");
    const options = baseOptions(root, {
      environment: {},
    });
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_996,
        exited: Promise.resolve(0),
        signalCode: null,
        stdout: textStream([]),
        stderr: textStream([]),
      }),
    };
    await expect(
      runAttempt(options, 1, "C-1", commandRoot, createCommandSigningCapability(), spawnApi),
    ).rejects.toThrow("command ownership token is missing");
  });

  test("records and persists signals when process group is terminated on timeout", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-timeout-signal-");
    const options = baseOptions(root, {
      argv: ["sleep", "10"],
      wallTimeoutMs: 50,
      idleTimeoutMs: 50,
      graceMs: 50,
      drainTimeoutMs: 50,
    });
    const result = await runAttempt(
      options,
      1,
      "C-1",
      commandRoot,
      createCommandSigningCapability(),
    );
    expect(result.record.status).toBe("timed_out");
    expect(result.record.signals_sent).toContain("SIGTERM");
  });

  test("flags cleanupPrewriteFailed when beginCleanupUncertain fails to write", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-unwritable-dir-");
    const attemptDir = join(commandRoot, "attempt-1");
    const options = baseOptions(root);
    const { chmodSync } = await import("node:fs");

    const spawnApi: BunSpawnApi = {
      spawn: () => {
        chmodSync(attemptDir, 0o500);
        return {
          pid: 999_999_995,
          exited: Promise.resolve(0),
          signalCode: null,
          stdout: textStream([]),
          stderr: textStream([]),
        };
      },
    };

    try {
      await expect(
        runAttempt(options, 1, "C-1", commandRoot, createCommandSigningCapability(), spawnApi),
      ).rejects.toThrow(/permission denied|EACCES/);
    } finally {
      chmodSync(attemptDir, 0o700);
    }
  });

  test("handles child whose exited promise rejects", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-exited-reject-");
    const options = baseOptions(root);
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_994,
        exited: Promise.reject(new Error("unexpected exit failure")),
        signalCode: null,
        stdout: textStream([]),
        stderr: textStream([]),
      }),
    };
    await expect(
      runAttempt(options, 1, "C-1", commandRoot, createCommandSigningCapability(), spawnApi),
    ).rejects.toThrow(/residual pid|termination withheld|unexpected exit failure/i);
  });
});
