import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join, posix } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  executePreparedCommand,
  prepareCommand,
} from "../../../olt/scripts/src/engine/runner/models/execution/index.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { writeAgentMetadata } from "../../../olt/scripts/src/runtime/session.ts";
import { atomicWriteJson } from "../../../olt/scripts/src/core/durable-write.ts";
import {
  startAttemptIntent,
  strongAttemptTerminalProof,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { recoverAggregateFromAttempts } from "../../../olt/scripts/src/integration/reconcile-command-attempts.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

const sampleIdentity: ProcessIdentity = { pid: 4242, parent: 100, group: 4242, birth: "birth-1" };

function freshRun(label: string): { runRoot: string; repo: string } {
  const root = scratchRoot(import.meta.path, label);
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  const runRoot = initRun(
    repo,
    `rec-run-${label}`,
    new TextEncoder().encode("prompt"),
    "file",
    true,
  );
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
  writeAgentMetadata(
    {
      agent_id: "coordinator",
      role: "coordinator",
      tier: 2,
      write_scope: ["."],
      allowed_read_scope: ["."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
    },
    runRoot,
  );
  return { runRoot, repo };
}

describe("reconcile-command-attempts", () => {
  test("returns undefined when no attempts exist on disk", async () => {
    const { runRoot, repo } = freshRun("no-attempts");
    const prepared = await prepareCommand({
      argv: ["echo", "test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });
    expect(recoverAggregateFromAttempts(runRoot, prepared.record)).toBeUndefined();
  });

  test("recovers single successful attempt aggregate from executed command", async () => {
    const { runRoot, repo } = freshRun("single-attempt");
    const prepared = await prepareCommand({
      argv: ["echo", "hello"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });

    const result = await executePreparedCommand(prepared);
    expect(result.record.exit_code).toBe(0);

    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record);
    expect(recovered).toBeDefined();
    expect(recovered?.status).toBe("succeeded");
    expect(recovered?.attempts?.length).toBe(1);
    expect(recovered?.exit_code).toBe(0);
  });

  test("recovers gate command with repository_after binding", async () => {
    const { runRoot, repo } = freshRun("gate-attempt");
    const prepared = await prepareCommand({
      argv: ["echo", "gate-test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "coordinator",
      gateId: "gate-1",
      runRoot,
      repositoryRoot: repo,
    });

    const result = await executePreparedCommand(prepared);
    expect(result.record.exit_code).toBe(0);

    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record);
    expect(recovered).toBeDefined();
    expect(recovered?.repository_after).toBeDefined();
    expect(recovered?.repository_after?.schema).toBe("harness.repository-binding");
  });

  test("recovers from attempt-started.json using default dependencies", async () => {
    const { runRoot, repo } = freshRun("started-only-default");
    const signer = createCommandSigningCapability();
    const runner = createInternalCommandRunner({ createCommandSigner: () => signer } as never);
    const prepared = await prepareCommand(
      {
        argv: ["echo", "recover-started"],
        cwd: repo,
        commandDir: join(runRoot, "commands"),
        actor: "implementer",
        runRoot,
        repositoryRoot: repo,
      },
      runner,
    );

    const commandDirectory = posix.dirname(prepared.record.record_path);
    const attemptDir = join(runRoot, commandDirectory, "attempt-1");
    mkdirSync(attemptDir, { recursive: true });
    const token = prepared.record.environment![OWNERSHIP_ENV]!;

    const controller = startAttemptIntent(
      attemptDir,
      prepared.record.id,
      1,
      prepared.record.started_at,
      token,
      () => undefined,
      signer,
    );
    // Bind a definitely non-existent pid so probeAttemptProcess returns "absent"
    const deadIdentity: ProcessIdentity = {
      pid: 999999999,
      parent: 1,
      group: 999999999,
      birth: "dead",
    };
    controller.bindRoot(deadIdentity);
    controller.beginCleanupUncertain(["cleanup"]);
    controller.recordSignal("SIGTERM");
    controller.recordSignal("SIGKILL");
    controller.markRecordPending("pending");
    controller.markTerminalProof("proven", strongAttemptTerminalProof(deadIdentity));

    // Call without injected dependencies to exercise defaults.probeProcess and defaults.now
    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record);

    expect(recovered).toBeDefined();
    expect(recovered?.status).toBe("failed");
    expect(recovered?.evidence_error).toBe(
      "attempt interrupted before terminal evidence was durable",
    );
  });

  test("throws INTEGRITY error when attempts exceed policy max_retries", async () => {
    const { runRoot, repo } = freshRun("too-many-attempts");
    const prepared = await prepareCommand({
      argv: ["echo", "too-many"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      policy: { timeout_seconds: 60, max_output_bytes: 1024, max_retries: 0 },
      runRoot,
      repositoryRoot: repo,
    });

    const result = await executePreparedCommand(prepared);
    expect(result.record.exit_code).toBe(0);

    const commandDirectory = posix.dirname(prepared.record.record_path);
    const attemptDir2 = join(runRoot, commandDirectory, "attempt-2");
    mkdirSync(attemptDir2, { recursive: true });
    atomicWriteJson(join(attemptDir2, "record.json"), {}, 0o600);

    expect(() => recoverAggregateFromAttempts(runRoot, prepared.record)).toThrow(
      /durable command attempts exceed retry policy/,
    );
  });

  test("throws INTEGRITY error when durable attempt verification fails", async () => {
    const { runRoot, repo } = freshRun("invalid-attempt");
    const prepared = await prepareCommand({
      argv: ["echo", "invalid-att"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });

    const result = await executePreparedCommand(prepared);
    const commandDirectory = posix.dirname(prepared.record.record_path);
    const recordFile = join(runRoot, commandDirectory, "attempt-1", "record.json");

    // Corrupt attempt record (wrong command id)
    const corrupt = { ...result.record.attempts![0], id: "C-CORRUPT" };
    atomicWriteJson(recordFile, corrupt, 0o600);

    expect(() => recoverAggregateFromAttempts(runRoot, prepared.record)).toThrow(
      /durable command attempt is invalid/,
    );
  });

  test("handles transient failure when retry is not exhausted", async () => {
    const { runRoot, repo } = freshRun("transient-retry");
    const prepared = await prepareCommand({
      argv: ["echo", "transient"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      policy: { timeout_seconds: 60, max_output_bytes: 1024, max_retries: 2 },
      runRoot,
      repositoryRoot: repo,
    });

    const result = await executePreparedCommand(prepared);
    const commandDirectory = posix.dirname(prepared.record.record_path);
    const recordFile = join(runRoot, commandDirectory, "attempt-1", "record.json");

    // Set failure_class to transient network_transient without retry_exhausted
    const attempt1 = {
      ...result.record.attempts![0],
      status: "failed" as const,
      failure_class: "network_transient" as const,
      timeout_kind: null,
      exit_code: 1,
    };
    atomicWriteJson(recordFile, attempt1, 0o600);

    const recovered = recoverAggregateFromAttempts(runRoot, prepared.record);
    expect(recovered).toBeDefined();
    expect(recovered?.evidence_error).toBe(
      "command stopped after durable attempt evidence before retry reconciliation",
    );
  });

  test("throws INTEGRITY error when recovered aggregate shape is invalid", async () => {
    const { runRoot, repo } = freshRun("invalid-aggregate-shape");
    const prepared = await prepareCommand({
      argv: ["echo", "test"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "implementer",
      runRoot,
      repositoryRoot: repo,
    });

    await executePreparedCommand(prepared);

    // Corrupt intent fingerprint so embeddedCommandIssues returns issues
    const corruptIntent = { ...prepared.record, fingerprint: "corrupt-fp" };
    expect(() => recoverAggregateFromAttempts(runRoot, corruptIntent)).toThrow(
      /recovered command aggregate is invalid/,
    );
  });
});
