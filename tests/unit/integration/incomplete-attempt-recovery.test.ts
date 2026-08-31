import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { prepareCommand } from "../../../olt/scripts/src/engine/runner/models/execution/index.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { writeAgentMetadata } from "../../../olt/scripts/src/runtime/session.ts";
import {
  startAttemptIntent,
  strongAttemptTerminalProof,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  artifact,
  interruptedAttempt,
  readStarted,
  recoverIncomplete,
  type AttemptReconciliationDependencies,
} from "../../../olt/scripts/src/integration/incomplete-attempt-recovery.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const sampleIdentity: ProcessIdentity = { pid: 4242, parent: 100, group: 4242, birth: "birth-1" };

function freshRun(label: string): { runRoot: string; repo: string } {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const runRoot = initRun(repo, `inc-run-${label}`, new TextEncoder().encode("prompt"), "file", true);
  writeAgentMetadata(
    {
      agent_id: "implementer",
      role: "implementer",
      tier: 3,
      write_scope: ["."],
      allowed_read_scope: ["."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
    },
    runRoot,
  );
  return { runRoot, repo };
}

describe("incomplete-attempt-recovery", () => {
  async function makeIntent(
    runRoot: string,
    repo: string,
    signer = createCommandSigningCapability(),
  ): Promise<{ intent: CommandRecord; signer: ReturnType<typeof createCommandSigningCapability> }> {
    const runner = createInternalCommandRunner({ createCommandSigner: () => signer } as never);
    const prepared = await prepareCommand(
      {
        argv: ["echo", "test"],
        cwd: repo,
        commandDir: join(runRoot, "commands"),
        actor: "implementer",
        runRoot,
        repositoryRoot: repo,
      },
      runner,
    );
    return { intent: prepared.record, signer };
  }

  test("artifact() creates empty file if missing and returns bounded metadata", () => {
    const root = scratchRoot(import.meta.path, "artifact-test");
    const logsDir = join(root, "logs");
    mkdirSync(logsDir, { recursive: true });
    const filePath = join(logsDir, "out.log");
    const meta = artifact(filePath, "logs/out.log", 1024);
    expect(meta.path).toBe("logs/out.log");
    expect(meta.bytes).toBe(0);
    expect(meta.sha256).toBeDefined();

    writeFileSync(filePath, "hello world");
    const meta2 = artifact(filePath, "logs/out.log", 1024);
    expect(meta2.bytes).toBe(11);
  });

  test("readStarted() validates and returns started record or throws INTEGRITY on mismatch", async () => {
    const { runRoot, repo } = freshRun("read-started");
    const { intent, signer } = await makeIntent(runRoot, repo);
    const attemptDir = join(runRoot, "commands", intent.id, "attempt-1");
    mkdirSync(attemptDir, { recursive: true });
    const token = intent.environment![OWNERSHIP_ENV]!;

    const controller = startAttemptIntent(
      attemptDir,
      intent.id,
      1,
      intent.started_at,
      token,
      () => undefined,
      signer,
    );
    controller.bindRoot(sampleIdentity);
    controller.beginCleanupUncertain(["test cleanup"]);
    controller.markRecordPending("pending");
    controller.markTerminalProof("absence proven", strongAttemptTerminalProof(sampleIdentity));

    const startedPath = join(attemptDir, "attempt-started.json");
    const loaded = readStarted(startedPath, intent, 1);
    expect(loaded.command_id).toBe(intent.id);

    // Mismatched public key
    const otherSigner = createCommandSigningCapability();
    const otherIntent = { ...intent, attempt_signing_public_key: otherSigner.verificationPublicKey };
    expect(() => readStarted(startedPath, otherIntent, 1)).toThrow(/durable attempt start is invalid/);
  });

  test("interruptedAttempt() produces failed CommandAttemptRecord and writes files", async () => {
    const { runRoot, repo } = freshRun("interrupted");
    const { intent, signer } = await makeIntent(runRoot, repo);
    const attemptDir = join(runRoot, "commands", intent.id, "attempt-1");
    mkdirSync(attemptDir, { recursive: true });
    const token = intent.environment![OWNERSHIP_ENV]!;

    const controller = startAttemptIntent(
      attemptDir,
      intent.id,
      1,
      intent.started_at,
      token,
      () => undefined,
      signer,
    );
    controller.bindRoot(sampleIdentity);
    controller.beginCleanupUncertain(["cleanup"]);
    controller.recordSignal("SIGTERM");
    controller.recordSignal("SIGKILL");
    controller.markRecordPending("pending");
    controller.markTerminalProof("proven", strongAttemptTerminalProof(sampleIdentity));

    const startedPath = join(attemptDir, "attempt-started.json");
    const started = readStarted(startedPath, intent, 1);

    const rec = interruptedAttempt(runRoot, intent, attemptDir, started, "2026-08-31T00:01:00.000Z");
    expect(rec.status).toBe("failed");
    expect(rec.failure_class).toBe("interrupted_unverified");
    expect(rec.integrity_failure).toBe("attempt interrupted before terminal evidence was durable");
    expect(rec.signals_sent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(rec.logs.stdout.path).toBe(`commands/${intent.id}/attempt-1/stdout.log`);
  });

  test("recoverIncomplete() returns undefined when disposition is not terminal strong_absence or process is not absent", async () => {
    const { runRoot, repo } = freshRun("recover-incomplete-branches");
    const { intent, signer } = await makeIntent(runRoot, repo);
    const attemptDir = join(runRoot, "commands", intent.id, "attempt-1");
    mkdirSync(attemptDir, { recursive: true });
    const token = intent.environment![OWNERSHIP_ENV]!;

    const deps: AttemptReconciliationDependencies = {
      probeProcess: () => "running",
      inspectRepository: () => ({} as never),
      now: () => new Date("2026-08-31T00:01:00.000Z"),
    };

    // Case 1: Probe returns running
    const c1 = startAttemptIntent(
      attemptDir,
      intent.id,
      1,
      intent.started_at,
      token,
      () => undefined,
      signer,
    );
    c1.bindRoot(sampleIdentity);
    c1.beginCleanupUncertain(["cleanup"]);
    c1.markRecordPending("pending");
    c1.markTerminalProof("proven", strongAttemptTerminalProof(sampleIdentity));

    expect(recoverIncomplete(runRoot, intent, attemptDir, 1, deps)).toBeUndefined();

    // Case 2: Process is absent -> successfully recovers
    const depsAbsent: AttemptReconciliationDependencies = {
      ...deps,
      probeProcess: () => "absent",
    };
    const rec = recoverIncomplete(runRoot, intent, attemptDir, 1, depsAbsent);
    expect(rec).toBeDefined();
    expect(rec?.status).toBe("failed");
  });
});
