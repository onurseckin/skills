import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { relative, join, sep } from "node:path";
import { tmpdir } from "node:os";
import type { CommandAttemptRecord } from "../../../olt/scripts/src/core/contracts/commands.ts";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/repository.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import { readBoundedBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { recoverAggregateFromAttempts } from "../../../olt/scripts/src/integration/reconcile-command-attempts.ts";
import { writeAttemptStarted } from "../../../olt/scripts/src/engine/runner/attempt-intent.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/attempt-disposition-capability.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/engine/runner/command-shape.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/internal-command-runner.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/pipe-ownership.ts";
import { runAttempt } from "../../../olt/scripts/src/engine/runner/run-attempt.ts";
import type {
  AttemptResult,
  BunSpawnApi,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/capture/runners/types.ts";

const roots: string[] = [];
const digest = (marker: string): string => marker.repeat(64);

function binding(marker: string): RepositoryBinding {
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

function metadata(root: string, path: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return {
    path: relative(root, path).split(sep).join("/"),
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
}

async function successfulAttempt(
  runRoot: string,
  commandRoot: string,
  id: string,
  attempt: number,
): Promise<AttemptResult> {
  const attemptRoot = join(commandRoot, `attempt-${attempt}`);
  await mkdir(attemptRoot);
  const stdoutPath = join(attemptRoot, "stdout.log"),
    stderrPath = join(attemptRoot, "stderr.log"),
    activityPath = join(attemptRoot, "activity.json");
  const startedAt = "2026-08-14T00:00:00.000Z",
    finishedAt = "2026-08-14T00:00:01.000Z";
  await writeFile(stdoutPath, "raw success\n");
  await writeFile(stderrPath, "");
  atomicWriteJson(
    activityPath,
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: id,
      attempt,
      status: "completed",
      started_at: startedAt,
      heartbeat_at: finishedAt,
      last_output_at: startedAt,
      stdout_bytes: 12,
      stderr_bytes: 0,
      finished_at: finishedAt,
    },
    0o600,
  );
  const record: CommandAttemptRecord = {
    id,
    attempt,
    status: "succeeded",
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: null,
    activity_path: relative(runRoot, activityPath).split(sep).join("/"),
    activity: metadata(runRoot, activityPath),
    logs: { stdout: metadata(runRoot, stdoutPath), stderr: metadata(runRoot, stderrPath) },
  };
  atomicWriteJson(join(attemptRoot, "record.json"), record, 0o600);
  return { record, attempt, stdoutPath, stderrPath, activityPath, outputTail: "raw success" };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("two-phase command attempt finalization", () => {
  test("persists a started marker before invoking the spawn dependency", async () => {
    const root = await mkdtemp(join(tmpdir(), "attempt-started-"));
    roots.push(root);
    const commandRoot = join(root, "commands", "C-started");
    await mkdir(commandRoot, { recursive: true });
    const ownershipToken = "12345678-1234-4234-8234-123456789abc";
    const options: NormalizedCommandOptions = {
      argv: ["injected"],
      cwd: root,
      repositoryRoot: root,
      commandDir: join(root, "commands"),
      runRoot: root,
      actor: "validator",
      wallTimeoutMs: 1000,
      idleTimeoutMs: 1000,
      graceMs: 10,
      drainTimeoutMs: 10,
      heartbeatIntervalMs: 1000,
      maxOutputBytes: 1024,
      retries: 0,
      idempotent: false,
      environment: { [OWNERSHIP_ENV]: ownershipToken },
    };
    const runtime = Bun as unknown as BunSpawnApi;
    const original = runtime.spawn;
    let marker: Record<string, unknown> | undefined;
    runtime.spawn = (() => {
      marker = JSON.parse(
        readFileSync(join(commandRoot, "attempt-1", "attempt-started.json"), "utf8"),
      );
      throw new Error("injected spawn stop");
    }) as BunSpawnApi["spawn"];
    try {
      await expect(
        runAttempt(options, 1, "C-started", commandRoot, createCommandSigningCapability()),
      ).rejects.toThrow("injected spawn stop");
    } finally {
      runtime.spawn = original;
    }
    expect(marker).toMatchObject({
      schema: "harness.command-attempt-started",
      version: 1,
      command_id: "C-started",
      attempt: 1,
      status: "running",
      root_pid_identity: null,
    });
  });

  test("leaves an unreturned started attempt running for conservative reconciliation", async () => {
    const root = await mkdtemp(join(tmpdir(), "attempt-unreturned-"));
    roots.push(root);
    const runRoot = join(root, ".olt", "capsules");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding("a"),
      attempt: async (options, attempt, id, commandRoot, signer) => {
        const attemptRoot = join(commandRoot, `attempt-${attempt}`);
        await mkdir(attemptRoot);
        await writeFile(join(attemptRoot, "stdout.log"), "");
        await writeFile(join(attemptRoot, "stderr.log"), "");
        writeAttemptStarted(
          attemptRoot,
          id,
          attempt,
          "2026-08-14T00:00:00.000Z",
          options.environment[OWNERSHIP_ENV]!,
          signer,
        );
        throw new Error("injected attempt interruption");
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["tool"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      "injected attempt interruption",
    );
    expect(JSON.parse(await readFile(prepared.recordPath, "utf8")).status).toBe("running");
    expect(
      recoverAggregateFromAttempts(runRoot, prepared.record, {
        probeProcess: () => {
          throw new Error("missing identity must not be probed");
        },
      }),
    ).toBeUndefined();
  });

  test("retains raw attempt evidence when the repository changes after the child exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "attempt-finalization-"));
    roots.push(root);
    const runRoot = join(root, ".olt", "capsules");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    let observations = 0,
      recordPath = "",
      rawAggregate: Record<string, unknown> | undefined;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observations += 1;
        if (observations === 3) rawAggregate = JSON.parse(readFileSync(recordPath, "utf8"));
        return binding(observations < 3 ? "a" : "b");
      },
      attempt: async (_options, attempt, id, commandRoot) =>
        successfulAttempt(runRoot, commandRoot, id, attempt),
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-finalize",
      idempotent: true,
    });
    recordPath = prepared.recordPath;

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      /repository.*changed|post-attempt.*integrity/i,
    );
    expect(rawAggregate).toMatchObject({
      status: "running",
      repository_after: null,
      attempts: [{ exit_code: 0 }],
    });
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    const terminalAttempt = JSON.parse(
      await readFile(join(prepared.commandRoot, "attempt-1", "record.json"), "utf8"),
    );
    expect(aggregate.attempts).toHaveLength(1);
    expect(aggregate.attempts[0].exit_code).toBe(0);
    expect(aggregate.attempts[0].logs.stdout.bytes).toBe(12);
    expect(aggregate.attempts[0].integrity_failure).toContain("repository changed");
    expect(aggregate.attempts[0]).toEqual(terminalAttempt);
    expect(aggregate.repository_after).toEqual(binding("b"));
    expect(aggregate.status).toBe("failed");
    expect(aggregate.retry_exhausted).toBeFalse();

    const retried = structuredClone(aggregate);
    retried.policy.max_retries = 1;
    retried.policy.idempotent = true;
    retried.attempts[0].failure_class = "network_transient";
    retried.attempts.push({
      ...structuredClone(retried.attempts[0]),
      attempt: 2,
      status: "succeeded",
      failure_class: null,
      integrity_failure: undefined,
    });
    retried.status = "succeeded";
    retried.retry_exhausted = false;
    expect(embeddedCommandIssues(retried)).toContain("attempt integrity failure cannot be retried");
  });

  test("captures repository_after for a successful gate terminalization", async () => {
    const root = await mkdtemp(join(tmpdir(), "attempt-success-after-"));
    roots.push(root);
    const runRoot = join(root, ".olt", "capsules");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding("a"),
      attempt: async (_options, attempt, id, commandRoot) =>
        successfulAttempt(runRoot, commandRoot, id, attempt),
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-success-after",
    });
    const result = await runner.executePreparedCommand(prepared);
    expect(result.record.status).toBe("succeeded");
    expect(result.record.repository_after).toEqual(binding("a"));
  });
});
