import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CommandAttemptStartedRecord } from "../../src/contracts/commands.ts";
import type { RepositoryBinding } from "../../src/contracts/repository.ts";
import { atomicWriteJson } from "../../src/core/durable-write.ts";
import { recoverAggregateFromAttempts } from "../../src/integration/reconcile-command-attempts.ts";
import {
  attemptStartedIssues,
  bindAttemptRootIdentity,
  startAttemptIntent,
  strongAttemptTerminalProof,
  writeAttemptStarted,
} from "../../src/runner/attempt-intent.ts";
import { createInternalCommandRunner } from "../../src/runner/internal-command-runner.ts";
import { createCommandSigningCapability } from "../../src/runner/attempt-disposition-capability.ts";
import { OWNERSHIP_ENV } from "../../src/runner/pipe-ownership.ts";
import type { ProcessIdentity } from "../../src/runner/process-identity.ts";
import { verifyCommandRecord } from "../../src/runner/verify-command.ts";

const roots: string[] = [];
const identity: ProcessIdentity = { pid: 4242, parent: 100, group: 4242, birth: "birth-1" };
const repository: RepositoryBinding = {
  schema: "harness.repository-binding",
  version: 1,
  inspection_sha256: "a".repeat(64),
  git_identity_sha256: "b".repeat(64),
  content_sha256: "c".repeat(64),
  file_count: 1,
  total_bytes: 1,
};

async function fixture(rootIdentity: ProcessIdentity | null = identity, terminalProof = false) {
  const root = await mkdtemp(join(tmpdir(), "attempt-reconcile-"));
  roots.push(root);
  const runRoot = join(root, ".harness");
  await mkdir(join(runRoot, "commands"), { recursive: true });
  const signer = createCommandSigningCapability();
  const runner = createInternalCommandRunner({
    inspectRepository: () => repository,
    attempt: async () => { throw new Error("must not execute"); },
    createCommandSigner: () => signer,
  });
  const prepared = await runner.prepareCommand({
    argv: ["tool"],
    cwd: root,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
    maxOutputBytes: 1024,
  });
  const attemptRoot = join(prepared.commandRoot, "attempt-1");
  await mkdir(attemptRoot);
  await writeFile(join(attemptRoot, "stdout.log"), "partial\n");
  await writeFile(join(attemptRoot, "stderr.log"), "");
  atomicWriteJson(
    join(attemptRoot, "activity.json"),
    {
      schema: "harness.command-activity",
      version: 1,
      command_id: prepared.record.id,
      attempt: 1,
      status: "completed",
      started_at: "2026-08-14T00:00:00.000Z",
      heartbeat_at: "2026-08-14T00:00:30.000Z",
      last_output_at: "2026-08-14T00:00:20.000Z",
      stdout_bytes: 8,
      stderr_bytes: 0,
      finished_at: "2026-08-14T00:00:30.000Z",
    },
    0o600,
  );
  const token = prepared.record.environment![OWNERSHIP_ENV]!;
  let marker: CommandAttemptStartedRecord;
  if (terminalProof) {
    const controller = startAttemptIntent(attemptRoot, prepared.record.id, 1, "2026-08-14T00:00:00.000Z", token, () => undefined, signer);
    controller.bindRoot(rootIdentity);
    controller.beginCleanupUncertain(["runner finalization interrupted"]);
    controller.recordSignal("SIGTERM");
    controller.markRecordPending("interrupted evidence is ready to persist");
    controller.markTerminalProof("root and descendant absence proven", strongAttemptTerminalProof(rootIdentity!));
    marker = JSON.parse(await readFile(join(attemptRoot, "attempt-started.json"), "utf8"));
  } else {
    marker = writeAttemptStarted(attemptRoot, prepared.record.id, 1, "2026-08-14T00:00:00.000Z", token, signer);
    if (rootIdentity) marker = bindAttemptRootIdentity(attemptRoot, marker, rootIdentity);
  }
  return { runRoot, prepared, attemptRoot, marker };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("incomplete command attempt reconciliation", () => {
  test("leaves a raw initial marker stranded even when its root later appears absent", async () => {
    const { runRoot, prepared } = await fixture();
    expect(recoverAggregateFromAttempts(runRoot, prepared.record, { probeProcess: () => "absent" })).toBeUndefined();
  });

  test("leaves a base-only marker from an initial disposition failure stranded", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture();
    const markerPath = join(attemptRoot, "attempt-started.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.root_pid_identity = null;
    marker.disposition_head_sha256 = marker.base_sha256;
    marker.cleanup_disposition = null;
    marker.cleanup_history = [];
    atomicWriteJson(markerPath, marker, 0o600);
    expect(recoverAggregateFromAttempts(runRoot, prepared.record, {
      probeProcess: () => { throw new Error("base-only marker must preclude a root process probe"); },
    })).toBeUndefined();
  });

  test("terminalizes without replay only after strong identity proves the child absent", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true);
    let probes = 0;
    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record, {
      probeProcess: () => { probes += 1; return "absent"; },
      now: () => new Date("2026-08-14T00:01:00.000Z"),
    });
    expect(probes).toBe(1);
    expect(recovered?.status).toBe("failed");
    expect(recovered?.attempts![0]).toMatchObject({
      exit_code: null,
      signal: null,
      signals_sent: ["SIGTERM"],
      timeout_kind: null,
      failure_class: "interrupted_unverified",
      integrity_failure: "attempt interrupted before terminal evidence was durable",
    });
    expect(recovered?.attempts![0]!.logs.stdout.bytes).toBe(8);
    expect(JSON.parse(await readFile(join(attemptRoot, "record.json"), "utf8"))).toEqual(recovered?.attempts![0]);
    expect(verifyCommandRecord(runRoot, recovered!).join("\n")).toBe("");
  });

  test("rejects a stripped terminal-proof disposition before reconciliation", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true);
    const markerPath = join(attemptRoot, "attempt-started.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.cleanup_disposition = null;
    atomicWriteJson(markerPath, marker, 0o600);
    expect(() => recoverAggregateFromAttempts(runRoot, prepared.record, { probeProcess: () => "absent" })).toThrow(/disposition|hash|history/i);
  });

  test("rejects a re-signed substituted marker key before probing the process", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, false);
    const substituted = createCommandSigningCapability();
    const controller = startAttemptIntent(
      attemptRoot,
      prepared.record.id,
      1,
      "2026-08-14T00:00:00.000Z",
      prepared.record.environment![OWNERSHIP_ENV]!,
      () => undefined,
      substituted,
    );
    controller.bindRoot(identity);
    controller.beginCleanupUncertain(["substituted marker key"]);
    controller.markRecordPending("forged recovery evidence is ready");
    controller.markTerminalProof("forged root absence proof", strongAttemptTerminalProof(identity));
    let probed = false;
    expect(() =>
      recoverAggregateFromAttempts(runRoot, prepared.record, {
        probeProcess: () => { probed = true; return "absent"; },
      }),
    ).toThrow(/public key.*command intent/i);
    expect(probed).toBeFalse();
  });

  test("strands a marker truncated to an earlier valid signed uncertainty", async () => {
    const { runRoot, prepared, attemptRoot, marker } = await fixture(identity, true);
    const uncertainIndex = marker.cleanup_history.findLastIndex((entry) => entry.status === "uncertain");
    const cleanup_history = marker.cleanup_history.slice(0, uncertainIndex + 1);
    const cleanup_disposition = cleanup_history.at(-1)!;
    const truncated = {
      ...marker,
      disposition_head_sha256: cleanup_disposition.sha256,
      cleanup_disposition,
      cleanup_history,
    };
    atomicWriteJson(join(attemptRoot, "attempt-started.json"), truncated, 0o600);
    expect(
      attemptStartedIssues(truncated, prepared.record.id, 1, prepared.record.environment![OWNERSHIP_ENV], prepared.record.attempt_signing_public_key),
    ).toEqual([]);
    expect(
      recoverAggregateFromAttempts(runRoot, prepared.record, {
        probeProcess: () => { throw new Error("truncated uncertainty must preclude process probing"); },
      }),
    ).toBeUndefined();
  });
});
