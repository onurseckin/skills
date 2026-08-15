import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommandAttemptRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { RepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import {
  MAX_COMMAND_ATTEMPTS,
  MAX_COMMAND_ATTEMPT_BYTES,
  MAX_COMMAND_INTENT_BYTES,
  MAX_COMMAND_RECORD_BYTES,
  MAX_EVIDENCE_ERROR_BYTES,
} from "../../../orchestrating-long-tasks/scripts/src/runner/command-record-size.ts";
import { createInternalCommandRunner } from "../../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import {
  executePreparedCommand as executePublic,
  prepareCommand as preparePublic,
} from "../../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import { OWNERSHIP_ENV } from "../../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import type {
  AttemptResult,
  NormalizedCommandOptions,
  PreparedCommand,
} from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const roots: string[] = [];
const digest = (marker: string): string => marker.repeat(64);

function binding(marker = "a"): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest(marker),
    git_identity_sha256: digest(marker),
    content_sha256: digest(marker),
    file_count: 1,
    total_bytes: 17,
  };
}

function attemptResult(id: string, attempt: number, transient = false): AttemptResult {
  const empty = { path: "empty", bytes: 0, sha256: digest("e") };
  const record: CommandAttemptRecord = {
    id,
    attempt,
    status: transient ? "failed" : "succeeded",
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: transient ? 1 : 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: transient ? "network_transient" : null,
    activity_path: "empty",
    activity: empty,
    logs: { stdout: empty, stderr: empty },
  };
  return {
    record,
    attempt,
    ...(transient ? { failureClass: "network_transient" as const } : {}),
    stdoutPath: "empty",
    stderrPath: "empty",
    activityPath: "empty",
    outputTail: "",
  };
}

async function fixture(label: string) {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, ".capsules", "commands"), { recursive: true });
  await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return {
    root,
    input: {
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".capsules"),
      commandDir: join(root, ".capsules", "commands"),
      actor: "validator" as const,
      taskId: "T-observed",
      gateId: "G-observed",
      retries: 1,
      idempotent: true,
      maxOutputBytes: 4096,
      wallTimeoutMs: 5000,
      idleTimeoutMs: 4000,
      graceMs: 3000,
      drainTimeoutMs: 2000,
      heartbeatIntervalMs: 1000,
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("command runtime boundary", () => {
  test("retries from one immutable durable execution snapshot", async () => {
    const { root, input } = await fixture("command-runtime-snapshot");
    const seen: NormalizedCommandOptions[] = [];
    let prepared: PreparedCommand;
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async (options, attempt, id) => {
        seen.push(options);
        if (attempt === 1) {
          prepared.options.argv[0] = "caller-mutated";
          prepared.options.cwd = join(root, "mutated");
          prepared.options.repositoryRoot = join(root, "mutated");
          prepared.options.actor = "attacker";
          prepared.options.taskId = "T-mutated";
          prepared.options.gateId = "G-mutated";
          prepared.options.retries = 0;
          prepared.options.idempotent = false;
          prepared.options.maxOutputBytes = 1;
          prepared.options.wallTimeoutMs = 1;
          prepared.options.environment.PATH = "/caller/mutated";
          return attemptResult(id, attempt, true);
        }
        return attemptResult(id, attempt);
      },
    });
    prepared = await runner.prepareCommand(input);
    const result = await runner.executePreparedCommand(prepared);

    expect(result.attempts).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({
      argv: [realpathSync(join(root, "bin", "verify"))],
      cwd: realpathSync(root),
      repositoryRoot: realpathSync(root),
      actor: "validator",
      taskId: "T-observed",
      gateId: "G-observed",
      retries: 1,
      idempotent: true,
      maxOutputBytes: 4096,
      wallTimeoutMs: 5000,
      environment: prepared.record.environment,
    });
  });

  test("retries a non-gate from one durable sanitized environment", async () => {
    const { input } = await fixture("command-runtime-non-gate");
    const secretKey = "LIMO_TEST_SECRET";
    const previousSecret = process.env[secretKey];
    process.env[secretKey] = "must-not-be-recorded";
    try {
      const environments: Record<string, string>[] = [];
      const runner = createInternalCommandRunner({
        inspectRepository: () => binding(),
        attempt: async (options, attempt, id) => {
          environments.push(options.environment);
          return attemptResult(id, attempt, attempt === 1);
        },
      });
      const prepared = await runner.prepareCommand({
        ...input,
        gateId: undefined,
        retries: 1,
        idempotent: true,
      });
      expect(prepared.record.environment?.[secretKey]).toBeUndefined();
      const durableEnvironment = structuredClone(prepared.record.environment!);
      prepared.options.environment.PATH = "/caller/mutated";
      await runner.executePreparedCommand(prepared);
      expect(environments).toEqual([durableEnvironment, durableEnvironment]);
      expect(environments[0]!.PATH).toBe(durableEnvironment.PATH);
      expect(environments[0]![OWNERSHIP_ENV]).toBe(environments[1]![OWNERSHIP_ENV]);
    } finally {
      if (previousSecret === undefined) delete process.env[secretKey];
      else process.env[secretKey] = previousSecret;
    }
  });

  test("uses one internal observer capability and keeps public APIs dependency-free", async () => {
    const { input } = await fixture("command-observer-capability");
    let invoked = false;
    const dependencies = {
      inspectRepository: () => binding("a"),
      attempt: async (_options: unknown, attempt: number, id: string) => {
        invoked = true;
        return attemptResult(id, attempt);
      },
    };
    const first = createInternalCommandRunner(dependencies);
    const second = createInternalCommandRunner({
      inspectRepository: () => binding("b"),
      attempt: async (_options, attempt, id) => attemptResult(id, attempt),
    });
    const prepared = await first.prepareCommand({ ...input, retries: 0 });
    dependencies.inspectRepository = () => binding("b");
    await expect(second.executePreparedCommand(prepared)).rejects.toThrow(/capability|runner/i);
    expect(invoked).toBeFalse();
    await first.executePreparedCommand(prepared);
    expect(invoked).toBeTrue();
    expect(preparePublic.length).toBe(1);
    expect(executePublic.length).toBe(1);
  });

  test("rejects mutation of the command attempt-signing key in immutable intent", async () => {
    const { input } = await fixture("command-signing-intent");
    let invoked = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async (_options, attempt, id) => {
        invoked = true;
        return attemptResult(id, attempt);
      },
    });
    const prepared = await runner.prepareCommand({ ...input, gateId: undefined, retries: 0 });
    expect(prepared.record.attempt_signing_public_key).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    prepared.record.attempt_signing_public_key = Buffer.alloc(44, 1).toString("base64");

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(/durable intent/i);
    expect(invoked).toBeFalse();
  });

  test("reserves terminal headroom and bounds evidence errors", async () => {
    const { input } = await fixture("command-intent-headroom");
    expect(
      MAX_COMMAND_INTENT_BYTES +
        (MAX_COMMAND_ATTEMPTS + 1) * MAX_COMMAND_ATTEMPT_BYTES +
        MAX_EVIDENCE_ERROR_BYTES,
    ).toBeLessThan(MAX_COMMAND_RECORD_BYTES);
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(),
      attempt: async () => {
        throw new Error("\0".repeat(MAX_EVIDENCE_ERROR_BYTES));
      },
    });
    await expect(
      runner.prepareCommand({
        ...input,
        argv: ["tool", "x".repeat(MAX_COMMAND_INTENT_BYTES)],
        gateId: undefined,
        retries: 0,
      }),
    ).rejects.toThrow(/intent.*size|size.*limit/i);
    expect(await readdir(input.commandDir)).toEqual([]);

    const prepared = await runner.prepareCommand({
      ...input,
      argv: ["tool", "x".repeat(MAX_COMMAND_INTENT_BYTES - 64 * 1024)],
      gateId: undefined,
      retries: 0,
    });
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow();
    const storedText = await readFile(prepared.recordPath, "utf8");
    const stored = JSON.parse(storedText);
    expect(new TextEncoder().encode(stored.evidence_error).byteLength).toBeLessThanOrEqual(
      MAX_EVIDENCE_ERROR_BYTES,
    );
    expect(Buffer.byteLength(storedText)).toBeLessThanOrEqual(MAX_COMMAND_RECORD_BYTES);
  });
});
