import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { runAttempt } from "../../../olt/scripts/src/engine/runner/models/attempt/run-attempt.ts";
import type {
  BunSpawnApi,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { cleanupTempRoots, getRunnerVfs, tempRoot } from "../command/fixture.ts";

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
      getRunnerVfs().readFileSync(join(commandRoot, "attempt-1", "attempt-started.json"), "utf8"),
    );
    expect(started.root_pid_identity).toBeNull();
  }, 10_000);

  test("surfaces an output-quota failure raised while the attempt is still running", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-quota-");
    const options = baseOptions(root, {
      maxOutputBytes: 1,
      wallTimeoutMs: 5000,
      idleTimeoutMs: 5000,
      graceMs: 1,
      drainTimeoutMs: 1,
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

  test("records status failed and preserves exit code when fake child exits non-zero", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-nonzero-");
    const options = baseOptions(root);
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_993,
        exited: Promise.resolve(42),
        signalCode: null,
        stdout: textStream(["some output\n"]),
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
    expect(result.record.status).toBe("failed");
    expect(result.record.exit_code).toBe(42);
    expect(result.record.signals_sent).toEqual([]);
    expect(result.outputTail).toBe("some output\n");
  });

  test("records stderr output and outputTail when stdout is empty", async () => {
    const { root, commandRoot } = attemptRoot("run-attempt-stderr-");
    const options = baseOptions(root);
    const spawnApi: BunSpawnApi = {
      spawn: () => ({
        pid: 999_999_992,
        exited: Promise.resolve(0),
        signalCode: null,
        stdout: textStream([]),
        stderr: textStream(["diagnostic error\n"]),
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
    expect(result.record.logs.stdout.bytes).toBe(0);
    expect(result.record.logs.stderr.bytes).toBe(17);
    expect(result.outputTail).toBe("diagnostic error\n");
  });
});
