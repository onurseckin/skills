import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandAttemptRecord,
  CommandRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import { readBoundedBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import {
  reconcileStrandedCommands,
  recordCommandIntent,
} from "../../../olt/scripts/src/integration/record-command.ts";
import { applyAttemptRecord } from "../../../olt/scripts/src/engine/runner/models/command/command-aggregate.ts";
import {
  settledAttemptTerminalProof,
  startAttemptIntent,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { embeddedCommandIssues } from "../../../olt/scripts/src/engine/runner/models/command/command-shape.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { initRun, loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

test("reconciles a crash after durable retry-pending evidence without replay", async () => {
  const repo = tempRoot("pending-retry-reconcile");
  const runRoot = initRun(repo, "pending-retry", new TextEncoder().encode("prompt"), "file", true);
  const signer = createCommandSigningCapability();
  const runner = createInternalCommandRunner({
    inspectRepository: () => {
      throw new Error("non-gate observer must not run");
    },
    attempt: async () => {
      throw new Error("reconciliation must not replay");
    },
    createCommandSigner: () => signer,
  });
  const prepared = await runner.prepareCommand({
    argv: ["tool"],
    cwd: repo,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
    idempotent: true,
    retries: 1,
  });
  recordCommandIntent(runRoot, "validator", prepared.record);
  const attemptRoot = join(prepared.commandRoot, "attempt-1");
  await mkdir(attemptRoot);
  await writeFile(join(attemptRoot, "stdout.log"), "retry\n");
  await writeFile(join(attemptRoot, "stderr.log"), "");
  const startedAt = "2026-08-14T00:00:00.000Z";
  const finishedAt = "2026-08-14T00:00:01.000Z";
  atomicWriteJson(
    join(attemptRoot, "activity.json"),
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: prepared.record.id,
      attempt: 1,
      status: "completed",
      started_at: startedAt,
      heartbeat_at: finishedAt,
      last_output_at: startedAt,
      stdout_bytes: 6,
      stderr_bytes: 0,
      finished_at: finishedAt,
    },
    0o600,
  );
  const controller = startAttemptIntent(
    attemptRoot,
    prepared.record.id,
    1,
    startedAt,
    prepared.record.environment![OWNERSHIP_ENV]!,
    () => undefined,
    signer,
  );
  controller.markRecordPending("retryable attempt evidence is ready");
  controller.markTerminalProof(
    "retryable attempt child settlement proven",
    settledAttemptTerminalProof(undefined),
  );
  const base = `${prepared.record.record_path.slice(0, -"record.json".length)}attempt-1`;
  const metadata = (name: string) => {
    const bytes = readBoundedBytes(join(attemptRoot, name), 1024 * 1024);
    return { path: `${base}/${name}`, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) };
  };
  const attempt: CommandAttemptRecord = {
    id: prepared.record.id,
    attempt: 1,
    status: "failed",
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: 1,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: "network_transient",
    activity_path: `${base}/activity.json`,
    activity: metadata("activity.json"),
    logs: { stdout: metadata("stdout.log"), stderr: metadata("stderr.log") },
    evidence_issues: [],
  };
  atomicWriteJson(join(attemptRoot, "record.json"), attempt, 0o600);
  const pending = structuredClone(prepared.record) as CommandRecord & { retry_pending?: boolean };
  applyAttemptRecord(pending, attempt);
  pending.retry_pending = true;
  pending.retry_exhausted = false;
  pending.evidence_error = "command retry pending before next attempt start";
  expect(embeddedCommandIssues(pending)).toEqual([]);
  atomicWriteJson(prepared.recordPath, pending, 0o600);

  expect(reconcileStrandedCommands(runRoot, "validator")).toEqual({
    reconciled: [prepared.record.id],
    stranded: [],
  });
  const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
  expect(aggregate.retry_pending).toBeUndefined();
  expect(aggregate.evidence_error).toContain("before retry reconciliation");
  expect(
    loadRun(runRoot).state.commands![prepared.record.id] as Record<string, unknown>,
  ).toMatchObject({ status: "failed", evidence_error: aggregate.evidence_error });
});
