import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { recoverAggregateFromAttempts } from "../../../olt/scripts/src/integration/reconcile-command-attempts.ts";
import {
  startAttemptIntent,
  strongAttemptTerminalProof,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import * as commandRecordSize from "../../../olt/scripts/src/engine/runner/models/command/command-record-size.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import type { PreparedCommand } from "../../../olt/scripts/src/engine/runner/types/types.ts";
import { getRunnerVfs, tempRoot, cleanupTempRoots } from "../command/fixture.ts";

const identity: ProcessIdentity = { pid: 4242, parent: 100, group: 4242, birth: "birth-1" };
const defaultSigner = createCommandSigningCapability();
const repository: RepositoryBinding = {
  schema: "harness.repository-binding",
  version: 1,
  inspection_sha256: "a".repeat(64),
  git_identity_sha256: "b".repeat(64),
  content_sha256: "c".repeat(64),
  file_count: 1,
  total_bytes: 1,
};

afterEach(cleanupTempRoots);

async function fixture(
  rootIdentity: ProcessIdentity | null = identity,
  gate = false,
  terminalProof = false,
  terminalSignals: NodeJS.Signals[] = ["SIGTERM"],
  signer = defaultSigner,
) {
  const root = tempRoot("attempt-reconcile-interrupted");
  const vfs = getRunnerVfs();
  const runRoot = join(root, ".olt", "capsules");
  vfs.mkdirSync(join(runRoot, "commands"), { recursive: true });
  if (gate) {
    vfs.mkdirSync(join(root, "bin"), { recursive: true });
    vfs.writeFileSync(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  }
  const runner = createInternalCommandRunner({
    inspectRepository: () => repository,
    attempt: async () => {
      throw new Error("must not execute");
    },
    createCommandSigner: () => signer,
  });
  const prepared = await runner.prepareCommand({
    argv: gate ? ["./bin/verify"] : ["tool"],
    cwd: root,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
    maxOutputBytes: 1024,
    ...(gate ? { gateId: "G-recover" } : {}),
  });
  const attemptRoot = join(prepared.commandRoot, "attempt-1");
  vfs.mkdirSync(attemptRoot, { recursive: true });
  vfs.writeFileSync(join(attemptRoot, "stdout.log"), "partial\n");
  vfs.writeFileSync(join(attemptRoot, "stderr.log"), "");
  vfs.writeFileSync(
    join(attemptRoot, "activity.json"),
    canonicalJsonBytes({
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
    }),
  );
  const token = prepared.record.environment![OWNERSHIP_ENV]!;
  if (terminalProof) {
    const controller = startAttemptIntent(
      attemptRoot,
      prepared.record.id,
      1,
      "2026-08-14T00:00:00.000Z",
      token,
      () => undefined,
      signer,
    );
    controller.bindRoot(rootIdentity);
    controller.beginCleanupUncertain(["runner finalization interrupted"]);
    for (const signal of terminalSignals) controller.recordSignal(signal);
    controller.markRecordPending("interrupted evidence is ready to persist");
    controller.markTerminalProof(
      "root and descendant absence proven",
      strongAttemptTerminalProof(rootIdentity!),
    );
  }
  return { runRoot, prepared, attemptRoot };
}

async function writeGateAttempt(
  prepared: PreparedCommand,
  attemptRoot: string,
  repositoryAfter?: RepositoryBinding,
): Promise<void> {
  const vfs = getRunnerVfs();
  const activityPath = join(attemptRoot, "activity.json");
  const finishedAt = "2026-08-14T00:00:40.000Z";
  const activity = JSON.parse(vfs.readFileSync(activityPath, "utf8"));
  vfs.writeFileSync(
    activityPath,
    canonicalJsonBytes({ ...activity, status: "completed", finished_at: finishedAt }),
  );
  const metadata = (name: string) => {
    const path = join(attemptRoot, name);
    const bytes = Buffer.from(vfs.readFileSync(path));
    return {
      path: `${prepared.record.record_path.slice(0, -"record.json".length)}attempt-1/${name}`,
      bytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    };
  };
  vfs.writeFileSync(
    join(attemptRoot, "record.json"),
    canonicalJsonBytes({
      id: prepared.record.id,
      attempt: 1,
      status: "succeeded",
      started_at: "2026-08-14T00:00:00.000Z",
      finished_at: finishedAt,
      exit_code: 0,
      signal: null,
      signals_sent: [],
      timeout_kind: null,
      failure_class: null,
      activity_path: metadata("activity.json").path,
      activity: metadata("activity.json"),
      logs: { stdout: metadata("stdout.log"), stderr: metadata("stderr.log") },
      evidence_issues: [],
      ...(repositoryAfter
        ? { repository_after: repositoryAfter, gate_finalized_at: finishedAt }
        : {}),
    }),
  );
}

describe("interrupted command attempt reconciliation", () => {
  test("leaves live, missing, and reused identities stranded", async () => {
    const vfs = getRunnerVfs();
    const cases = [
      { marker: identity, proof: "live" },
      { marker: identity, proof: "reused" },
      { marker: identity, proof: "unknown" },
      { marker: null, proof: "unknown" },
    ] as const;
    for (const entry of cases) {
      const { runRoot, prepared } = await fixture(entry.marker);
      const recovered = recoverAggregateFromAttempts(runRoot, prepared.record, {
        probeProcess: () => entry.proof,
        now: () => new Date("2026-08-14T00:01:00.000Z"),
      });
      expect(recovered).toBeUndefined();
      expect(JSON.parse(vfs.readFileSync(prepared.recordPath, "utf8")).status).toBe("running");
    }
  });

  test("fails a raw gate attempt when recovery cannot prove its post-observation", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true, true, []);
    await writeGateAttempt(prepared, attemptRoot);
    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record, {
      probeProcess: () => "absent",
      inspectRepository: () => repository,
      now: () => new Date("2026-08-14T00:01:00.000Z"),
    });
    expect(recovered).toMatchObject({ status: "failed", repository_after: repository });
    expect(recovered?.attempts![0]).toMatchObject({
      exit_code: 0,
      integrity_failure: "gate post-observation interrupted before integrity finalization",
    });
  });

  test("fails a finalized gate whose same-attempt repository binding drifted", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true, true, []);
    const sameAttempt = { ...repository, inspection_sha256: "d".repeat(64) };
    await writeGateAttempt(prepared, attemptRoot, sameAttempt);
    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record, {
      inspectRepository: () => {
        throw new Error("must not substitute a recovery-time binding");
      },
    });
    expect(recovered).toMatchObject({ status: "failed", repository_after: sameAttempt });
    expect(recovered?.attempts![0]).toMatchObject({
      repository_after: sameAttempt,
      integrity_failure: "gate repository changed before durable integrity finalization",
    });
  });

  test("rejects an oversized durable attempt before aggregate publication", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true, true, []);
    const vfs = getRunnerVfs();
    await writeGateAttempt(prepared, attemptRoot, repository);
    const recordPath = join(attemptRoot, "record.json");
    const attempt = JSON.parse(vfs.readFileSync(recordPath, "utf8"));
    vfs.writeFileSync(
      recordPath,
      canonicalJsonBytes({ ...attempt, padding: "x".repeat(1024 * 1024) }),
    );
    expect(() => recoverAggregateFromAttempts(runRoot, prepared.record)).toThrow(
      /maximum|size|large/i,
    );
    expect(JSON.parse(vfs.readFileSync(prepared.recordPath, "utf8")).status).toBe("running");
  });

  test("rejects an oversized recovered aggregate before publication", async () => {
    const { runRoot, prepared, attemptRoot } = await fixture(identity, true, true, []);
    const vfs = getRunnerVfs();
    await writeGateAttempt(prepared, attemptRoot, repository);
    const spy = spyOn(commandRecordSize, "assertCommandRecordSize").mockImplementation(() => {
      throw new HarnessError("INVALID_STATE", "command record exceeds size limit");
    });
    try {
      expect(() => recoverAggregateFromAttempts(runRoot, prepared.record)).toThrow(
        /maximum|size|limit/i,
      );
      expect(JSON.parse(vfs.readFileSync(prepared.recordPath, "utf8")).status).toBe("running");
    } finally {
      spy.mockRestore();
    }
  });
});
