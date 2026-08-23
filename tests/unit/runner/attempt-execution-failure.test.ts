import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { relative, join, sep } from "node:path";
import { tmpdir } from "node:os";
import type { CommandAttemptRecord } from "../../../olt/scripts/src/contracts/commands.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import { readBoundedBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { recoverAggregateFromAttempts } from "../../../olt/scripts/src/integration/reconcile-command-attempts.ts";
import { AttemptExecutionError } from "../../../olt/scripts/src/runner/attempt-execution-error.ts";
import {
  settledAttemptTerminalProof,
  startAttemptIntent,
  strongAttemptTerminalProof,
} from "../../../olt/scripts/src/runner/attempt-intent.ts";
import { settleBounded } from "../../../olt/scripts/src/runner/attempt-support.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/runner/command-shape.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/runner/internal-command-runner.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/runner/pipe-ownership.ts";
import type {
  AttemptResult,
  FailureClass,
  NormalizedCommandOptions,
} from "../../../olt/scripts/src/runner/types.ts";
import { verifyCommandRecord } from "../../../olt/scripts/src/runner/verify-command.ts";
import type { CommandSigningCapability } from "../../../olt/scripts/src/runner/attempt-disposition-capability.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function portable(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function metadata(root: string, path: string) {
  const bytes = readBoundedBytes(path, 1024 * 1024);
  return { path: portable(root, path), bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
}

async function attemptResult(
  options: NormalizedCommandOptions,
  commandRoot: string,
  id: string,
  attempt: number,
  failureClass: FailureClass,
  signer: CommandSigningCapability,
  integrityFailure?: string,
): Promise<AttemptResult> {
  const attemptRoot = join(commandRoot, `attempt-${attempt}`);
  await mkdir(attemptRoot);
  const stdoutPath = join(attemptRoot, "stdout.log"),
    stderrPath = join(attemptRoot, "stderr.log"),
    activityPath = join(attemptRoot, "activity.json");
  const startedAt = `2026-08-14T00:00:0${attempt}.000Z`,
    finishedAt = `2026-08-14T00:00:1${attempt}.000Z`;
  const output = `attempt ${attempt}\n`;
  await writeFile(stdoutPath, output);
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
  const rootIdentity = { pid: 4000 + attempt, parent: 100, group: 4000 + attempt, birth: "root" };
  if (failureClass === "evidence_failure") controller.bindRoot(rootIdentity);
  controller.beginCleanupUncertain(["injected terminal fixture"]);
  controller.markRecordPending("injected terminal evidence is ready");
  controller.markTerminalProof(
    "injected terminal process proof",
    failureClass === "evidence_failure"
      ? strongAttemptTerminalProof(rootIdentity)
      : settledAttemptTerminalProof(undefined),
  );
  atomicWriteJson(
    activityPath,
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: id,
      attempt,
      status: integrityFailure === undefined ? "completed" : "failed",
      started_at: startedAt,
      heartbeat_at: finishedAt,
      last_output_at: startedAt,
      stdout_bytes: Buffer.byteLength(output),
      stderr_bytes: 0,
      finished_at: finishedAt,
    },
    0o600,
  );
  const record: CommandAttemptRecord = {
    id,
    attempt,
    status: "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: 1,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: failureClass,
    activity_path: portable(options.runRoot, activityPath),
    activity: metadata(options.runRoot, activityPath),
    logs: {
      stdout: metadata(options.runRoot, stdoutPath),
      stderr: metadata(options.runRoot, stderrPath),
    },
    ...(integrityFailure === undefined ? {} : { integrity_failure: integrityFailure }),
  };
  return {
    record,
    attempt,
    failureClass,
    stdoutPath,
    stderrPath,
    activityPath,
    outputTail: output,
  };
}

async function fixture(name: string) {
  const repositoryRoot = await mkdtemp(join(tmpdir(), name));
  roots.push(repositoryRoot);
  const runRoot = join(repositoryRoot, ".capsules", "run");
  await mkdir(join(runRoot, "commands"), { recursive: true });
  return { repositoryRoot, runRoot };
}

describe("terminal attempt execution failures", () => {
  test("distinguishes settled pumps from uncertain evidence drains", async () => {
    expect(await settleBounded([Promise.resolve()], 1)).toBeTrue();
    expect(await settleBounded([new Promise(() => undefined)], 1)).toBeFalse();
  });

  test("publishes first-attempt evidence failure before rethrowing its original error", async () => {
    const { repositoryRoot, runRoot } = await fixture("attempt-evidence-first-");
    const original = new Error("combined command output quota exceeded (1024 bytes)");
    let calls = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("non-gate observer must not run");
      },
      attempt: async (options, attempt, id, commandRoot, signer) => {
        calls += 1;
        const result = await attemptResult(
          options,
          commandRoot,
          id,
          attempt,
          "evidence_failure",
          signer,
          original.message,
        );
        throw new AttemptExecutionError(original, result);
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["tool"],
      cwd: repositoryRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      retries: 2,
      idempotent: true,
    });
    let caught: unknown;
    try {
      await runner.executePreparedCommand(prepared);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
    expect(calls).toBe(1);
    const stored = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(stored).toMatchObject({
      status: "failed",
      evidence_error: original.message,
      retry_exhausted: false,
      attempts: [{ attempt: 1, failure_class: "evidence_failure" }],
    });
    expect(verifyCommandRecord(runRoot, stored)).toEqual([]);
    const mismatched = structuredClone(stored);
    mismatched.evidence_error = "different evidence failure";
    expect(embeddedCommandIssues(mismatched)).toContain(
      "aggregate evidence error does not match its final attempt integrity failure",
    );
  });

  test("preserves a later evidence failure instead of recovering it as interrupted", async () => {
    const { repositoryRoot, runRoot } = await fixture("attempt-evidence-later-");
    const original = new Error("second-attempt evidence storage failed");
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("non-gate observer must not run");
      },
      attempt: async (options, attempt, id, commandRoot, signer) => {
        if (attempt === 1)
          return attemptResult(options, commandRoot, id, attempt, "network_transient", signer);
        const result = await attemptResult(
          options,
          commandRoot,
          id,
          attempt,
          "evidence_failure",
          signer,
          original.message,
        );
        throw new AttemptExecutionError(original, result);
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["tool"],
      cwd: repositoryRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      retries: 2,
      idempotent: true,
    });
    let caught: unknown;
    try {
      await runner.executePreparedCommand(prepared);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
    const stored = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(stored).toMatchObject({
      status: "failed",
      evidence_error: original.message,
      retry_exhausted: false,
      attempts: [
        { attempt: 1, failure_class: "network_transient" },
        { attempt: 2, failure_class: "evidence_failure", integrity_failure: original.message },
      ],
    });
    expect(verifyCommandRecord(runRoot, stored)).toEqual([]);
    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record, {
      probeProcess: () => {
        throw new Error("terminal attempts must not probe process identity");
      },
    });
    expect(recovered).toMatchObject({
      status: "failed",
      evidence_error: original.message,
      attempts: [
        { attempt: 1, failure_class: "network_transient" },
        { attempt: 2, failure_class: "evidence_failure" },
      ],
    });
  });
});
