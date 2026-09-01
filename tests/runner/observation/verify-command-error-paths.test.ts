import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { relative, join, sep } from "node:path";
import type {
  CommandAttemptRecord,
  CommandRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import { readBoundedBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  settledAttemptTerminalProof,
  startAttemptIntent,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import type {
  AttemptResult,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/engine/runner/types/types.ts";
import {
  verifyCommandAttempt,
  verifyCommandRecord,
} from "../../../olt/scripts/src/engine/runner/signing/verify-command.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function metadata(root: string, path: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: portable(root, path), bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

function binding(): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "a".repeat(64),
    git_identity_sha256: "a".repeat(64),
    content_sha256: "a".repeat(64),
    file_count: 1,
    total_bytes: 17,
  };
}

async function succeededFixture(name: string): Promise<{ runRoot: string; stored: CommandRecord }> {
  const repositoryRoot = tempRoot(name);
  await mkdir(join(repositoryRoot, "bin"));
  await writeFile(join(repositoryRoot, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const runRoot = join(repositoryRoot, ".olt", "capsules", "run");
  await mkdir(join(runRoot, "commands"), { recursive: true });

  const runner = createInternalCommandRunner({
    inspectRepository: () => binding(),
    attempt: async (options: NormalizedCommandOptions, attempt, id, commandRoot, signer) => {
      const attemptRoot = join(commandRoot, `attempt-${attempt}`);
      await mkdir(attemptRoot);
      const stdoutPath = join(attemptRoot, "stdout.log");
      const stderrPath = join(attemptRoot, "stderr.log");
      const activityPath = join(attemptRoot, "activity.json");
      const startedAt = "2026-08-14T00:00:00.000Z";
      const finishedAt = "2026-08-14T00:00:01.000Z";
      await writeFile(stdoutPath, "ok\n");
      await writeFile(stderrPath, "");
      const controller = startAttemptIntent(
        attemptRoot,
        id,
        attempt,
        startedAt,
        options.environment[OWNERSHIP_ENV]!,
        () => undefined,
        signer,
      );
      controller.beginCleanupUncertain(["fixture cleanup"]);
      controller.markRecordPending("fixture evidence ready");
      controller.markTerminalProof(
        "fixture terminal proof",
        settledAttemptTerminalProof(undefined),
      );
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
          stdout_bytes: 3,
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
        activity_path: portable(options.runRoot, activityPath),
        activity: metadata(options.runRoot, activityPath),
        logs: {
          stdout: metadata(options.runRoot, stdoutPath),
          stderr: metadata(options.runRoot, stderrPath),
        },
      };
      const result: AttemptResult = {
        record,
        attempt,
        stdoutPath,
        stderrPath,
        activityPath,
        outputTail: "ok\n",
      };
      return result;
    },
  });
  const prepared = await runner.prepareCommand({
    argv: ["./bin/verify"],
    cwd: repositoryRoot,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
  });
  await runner.executePreparedCommand(prepared);
  const stored = JSON.parse(await readFile(prepared.recordPath, "utf8")) as CommandRecord;
  expect(verifyCommandRecord(runRoot, stored)).toEqual([]);
  return { runRoot, stored };
}

describe("verify-command artifact-read error paths", () => {
  test("reports a stdout log issue and an output-evidence read issue when the log file is missing", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-missing-stdout-");
    const attempt = stored.attempts![0]!;
    const stdoutAbsolute = join(runRoot, attempt.logs.stdout.path);
    await unlink(stdoutAbsolute);
    const issues = verifyCommandAttempt(runRoot, stored, attempt, 0);
    expect(issues.some((issue) => issue.startsWith("attempt 1 stdout log is invalid: "))).toBe(
      true,
    );
    expect(
      issues.some((issue) => issue.startsWith("attempt 1 output evidence cannot be read: ")),
    ).toBe(true);
  });

  test("reports an unreadable started-marker issue when attempt-started.json is missing", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-missing-started-");
    const attempt = stored.attempts![0]!;
    const startedPath = join(
      runRoot,
      `${stored.record_path.replace(/\/record\.json$/u, "")}/attempt-1/attempt-started.json`,
    );
    await unlink(startedPath);
    const issues = verifyCommandAttempt(runRoot, stored, attempt, 0);
    expect(
      issues.some((issue) => issue.startsWith("attempt 1 started marker cannot be read: ")),
    ).toBe(true);
  });

  test("reports an unreadable activity issue when activity.json is missing", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-missing-activity-");
    const attempt = stored.attempts![0]!;
    await unlink(join(runRoot, attempt.activity_path));
    const issues = verifyCommandAttempt(runRoot, stored, attempt, 0);
    expect(issues.some((issue) => issue.startsWith("attempt 1 activity cannot be read: "))).toBe(
      true,
    );
  });

  test("reports an unreadable attempt-record issue when the attempt record.json is missing", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-missing-attempt-record-");
    const attempt = stored.attempts![0]!;
    const attemptRecordPath = join(
      runRoot,
      `${stored.record_path.replace(/\/record\.json$/u, "")}/attempt-1/record.json`,
    );
    await unlink(attemptRecordPath);
    const issues = verifyCommandAttempt(runRoot, stored, attempt, 0);
    expect(
      issues.some((issue) => issue.startsWith("attempt 1 attempt record cannot be read: ")),
    ).toBe(true);
  });

  test("flags inconsistent timeout evidence when status and timeout_kind disagree", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-timeout-mismatch-");
    const attempt = { ...stored.attempts![0]!, status: "timed_out" as const };
    const issues = verifyCommandAttempt(runRoot, stored, attempt, 0);
    expect(issues).toContain("attempt 1 timeout evidence is inconsistent");
  });

  test("falls back to a schema-invalid issue when attempt checking itself throws", () => {
    const command = { policy: undefined } as unknown as CommandRecord;
    const attempt = {
      id: "C-1",
      attempt: 1,
      status: "succeeded",
      failure_class: null,
      timeout_kind: null,
      signals_sent: [],
      started_at: "2026-08-14T00:00:00.000Z",
      finished_at: "2026-08-14T00:00:01.000Z",
      activity_path: "commands/C-1/attempt-1/activity.json",
      activity: { path: "commands/C-1/attempt-1/activity.json", bytes: 0, sha256: "e".repeat(64) },
      logs: {
        stdout: { path: "commands/C-1/attempt-1/stdout.log", bytes: 0, sha256: "e".repeat(64) },
        stderr: { path: "commands/C-1/attempt-1/stderr.log", bytes: 0, sha256: "e".repeat(64) },
      },
    } as unknown as CommandAttemptRecord;
    const issues = verifyCommandAttempt("/nonexistent-run-root", command, attempt, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^attempt 1 schema is invalid: /);
  });
});

describe("verify-command aggregate-record disk check", () => {
  test("flags a mismatch between the given record and what is durably stored", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-aggregate-mismatch-");
    const mutated = { ...stored, actor: "someone-else" };
    expect(verifyCommandRecord(runRoot, mutated)).toContain(
      "aggregate command record does not match disk",
    );
  });

  test("reports an unreadable-aggregate issue when the durable record.json is missing", async () => {
    const { runRoot, stored } = await succeededFixture("verify-command-aggregate-missing-");
    await unlink(join(runRoot, stored.record_path));
    const issues = verifyCommandRecord(runRoot, stored);
    expect(
      issues.some((issue) => issue.startsWith("aggregate command record cannot be read: ")),
    ).toBe(true);
  });
});

describe("verify-command non-gate path-binding guard", () => {
  test("flags a non-gate command that carries gate path bindings", () => {
    const record = {
      id: "C-1",
      gate_id: null,
      path_bindings: [],
      policy: undefined,
    } as unknown as CommandRecord;
    expect(verifyCommandRecord("/nonexistent-run-root", record)).toContain(
      "non-gate command contains gate path bindings",
    );
  });
});
