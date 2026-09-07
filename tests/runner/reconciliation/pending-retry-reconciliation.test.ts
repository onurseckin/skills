import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import type {
  CommandAttemptRecord,
  CommandRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { sha256Bytes, canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
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
import { getRunnerVfs, tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

const promptBytes = new Uint8Array([112, 114, 111, 109, 112, 116]);
const signer = createCommandSigningCapability();

test("reconciles a crash after durable retry-pending evidence without replay", async () => {
  const repo = tempRoot("pending-retry-reconcile");
  const runRoot = initRun(repo, "pending-retry", promptBytes, "file", true);
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
  const vfs = getRunnerVfs();
  const attemptRoot = join(prepared.commandRoot, "attempt-1");
  vfs.mkdirSync(attemptRoot, { recursive: true });
  const stdoutBytes = Buffer.from("retry\n");
  const stderrBytes = Buffer.alloc(0);
  vfs.writeFileSync(join(attemptRoot, "stdout.log"), stdoutBytes);
  vfs.writeFileSync(join(attemptRoot, "stderr.log"), stderrBytes);
  const startedAt = "2026-08-14T00:00:00.000Z";
  const finishedAt = "2026-08-14T00:00:01.000Z";
  const activityBytes = canonicalJsonBytes({
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
  });
  vfs.writeFileSync(join(attemptRoot, "activity.json"), activityBytes);
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
  const meta = (name: string, bytes: Uint8Array) => ({
    path: `${base}/${name}`,
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
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
    activity: meta("activity.json", activityBytes),
    logs: { stdout: meta("stdout.log", stdoutBytes), stderr: meta("stderr.log", stderrBytes) },
    evidence_issues: [],
  };
  vfs.writeFileSync(join(attemptRoot, "record.json"), canonicalJsonBytes(attempt));
  const pending = structuredClone(prepared.record) as CommandRecord & { retry_pending?: boolean };
  applyAttemptRecord(pending, attempt);
  pending.retry_pending = true;
  pending.retry_exhausted = false;
  pending.evidence_error = "command retry pending before next attempt start";
  expect(embeddedCommandIssues(pending)).toEqual([]);
  vfs.writeFileSync(prepared.recordPath, canonicalJsonBytes(pending));

  expect(reconcileStrandedCommands(runRoot, "validator")).toEqual({
    reconciled: [prepared.record.id],
    stranded: [],
  });
  const aggregate = JSON.parse(vfs.readFileSync(prepared.recordPath, "utf8"));
  expect(aggregate.retry_pending).toBeUndefined();
  expect(aggregate.evidence_error).toContain("before retry reconciliation");
  expect(
    loadRun(runRoot, false).state.commands![prepared.record.id] as Record<string, unknown>,
  ).toMatchObject({ status: "failed", evidence_error: aggregate.evidence_error });
});
