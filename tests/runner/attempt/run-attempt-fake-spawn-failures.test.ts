import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { runAttempt } from "../../../olt/scripts/src/engine/runner/models/attempt/run-attempt.ts";
import type {
  BunSpawnApi,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { chmodVirtualFile, cleanupTempRoots, getRunnerVfs, tempRoot } from "../command/fixture.ts";

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

afterEach(cleanupTempRoots);

function attemptRoot(label: string): { root: string; commandRoot: string } {
  const root = tempRoot(label);
  const commandRoot = join(root, "commands", "C-1");
  getRunnerVfs().mkdirSync(commandRoot, { recursive: true });
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

describe("runAttempt via an injected spawnApi - failures and edge cases", () => {
  test("fails with a residual-pid error when the wall timeout fires and root identity never bound", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-timeout-");
    const options = baseOptions(root, {
      wallTimeoutMs: 2,
      idleTimeoutMs: 5000,
      graceMs: 1,
      drainTimeoutMs: 5,
    });
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
      argv: ["fake"],
      cwd: root,
      wallTimeoutMs: 5,
      idleTimeoutMs: 50,
      graceMs: 1,
      drainTimeoutMs: 5,
    });
    let resolveExited: ((code: number) => void) | undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });
    const handlers = new Map<number, () => void>();
    handlers.set(999999, () => {
      resolveExited?.(0);
    });
    (globalThis as unknown as Record<string, unknown>).__virtualFsKillHandlers = handlers;

    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999999,
        exited,
        signalCode: null,
        stdout: textStream([]),
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
    expect(result.record.status).toBe("timed_out");
    expect(result.record.signals_sent).toContain("SIGTERM");
  });

  test("flags cleanupPrewriteFailed when beginCleanupUncertain fails to write", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-unwritable-dir-");
    const attemptDir = join(commandRoot, "attempt-1");
    const options = baseOptions(root);

    const spawnApi: BunSpawnApi = {
      spawn: () => {
        chmodVirtualFile(attemptDir, 0o500);
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
      chmodVirtualFile(attemptDir, 0o700);
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
