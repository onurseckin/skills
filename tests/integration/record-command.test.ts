import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { initCapsuleRun, loadRun, transact } from "../../olt/scripts/src/engine/store/index.ts";
import {
  recordCommandIntent,
  reconcileStrandedCommands,
} from "../../olt/scripts/src/integration/record-command.ts";
import { canonicalCommandFingerprint } from "../../olt/scripts/src/engine/runner/models/command/command-id.ts";
import { createCommandSigningCapability } from "../../olt/scripts/src/engine/runner/models/command/index.ts";
import {
  normalizeCommandOptions,
  policyRecord,
} from "../../olt/scripts/src/engine/runner/core/policy.ts";
import { atomicWriteJson } from "../../olt/scripts/src/core/durable-write.ts";
import type { CommandRecord } from "../../olt/scripts/src/core/contracts/index.ts";
import { inspectRepositoryBinding } from "../../olt/scripts/src/packets/repository-identity.ts";
import { writeAttemptStarted } from "../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { OWNERSHIP_ENV } from "../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";

let lastSigner: ReturnType<typeof createCommandSigningCapability>;

describe("integration/record-command stranded recovery", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });

  async function createTestFixture(runIdPrefix: string) {
    const runId = `${runIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { runRoot } = initCapsuleRun(runId, { allowExisting: true });

    transact(runRoot, "coordinator", "agent-registered", { agent_id: "coordinator" }, (draft) => {
      draft.agents = [
        {
          id: "coordinator",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "test-host",
          granted_at: new Date().toISOString(),
          status: "active",
        },
      ];
    });

    return {
      runRoot,
    };
  }

  async function createRunningIntent(
    runRoot: string,
    cmdId: string,
    options: {
      startedAt: string;
      gateId?: string | null;
      taskId?: string | null;
    },
  ): Promise<CommandRecord> {
    const cmdDir = join(runRoot, "commands", cmdId);
    vfs.mkdirSync(cmdDir, { recursive: true });

    const cwd = process.cwd();
    const argv = ["echo", "test-" + cmdId];
    const fingerprint = canonicalCommandFingerprint(cwd, argv);
    lastSigner = createCommandSigningCapability();
    const normalized = await normalizeCommandOptions({
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "coordinator",
      argv,
      cwd,
      ...(options.gateId ? { gateId: options.gateId } : {}),
      ...(options.taskId ? { taskId: options.taskId } : {}),
    });

    const isGate = Boolean(options.gateId);
    const record: CommandRecord = {
      id: cmdId,
      argv,
      cwd,
      cwd_relative: ".",
      repository_root: cwd,
      status: "running",
      task_id: options.taskId ?? null,
      gate_id: options.gateId ?? null,
      started_at: options.startedAt,
      finished_at: null,
      exit_code: null,
      signal: null,
      fingerprint,
      attempt_signing_public_key: lastSigner.verificationPublicKey,
      record_path: `commands/${cmdId}/record.json`,
      actor: "coordinator",
      environment: normalized.environment,
      policy: policyRecord(normalized),
      ...(isGate
        ? {
            assurance: "trusted_host_observed_v1",
            repository_before: inspectRepositoryBinding(cwd),
            repository_after: null,
          }
        : {}),
    };

    atomicWriteJson(join(cmdDir, "record.json"), record, 0o600);
    recordCommandIntent(runRoot, "coordinator", record);
    return record;
  }

  it("reconciles stranded command without active attempt after grace period to terminal failed", async () => {
    const { runRoot } = await createTestFixture("stranded-basic");
    const past = new Date("2026-01-01T00:00:00.000Z").toISOString();
    await createRunningIntent(runRoot, "C-stranded-1", { startedAt: past });

    const result = reconcileStrandedCommands(runRoot, "coordinator", {
      gracePeriodMs: 5000,
      now: () => new Date("2026-01-01T00:05:00.000Z"),
    });

    expect(result.reconciled).toContain("C-stranded-1");
    expect(result.stranded).toHaveLength(0);

    const state = loadRun(runRoot, false).state;
    const cmd = (state.commands as Record<string, CommandRecord>)["C-stranded-1"];
    expect(cmd.status).toBe("failed");
    expect(cmd.exit_code).toBe(1);
    expect(cmd.failure_class).toBe("interrupted_or_lost");
    expect(cmd.evidence_error).toBe("interrupted_or_lost");
    expect(cmd.finished_at).toBeTruthy();
  });

  it("preserves active command intent within the grace period", async () => {
    const { runRoot } = await createTestFixture("stranded-grace");
    const recent = new Date("2026-01-01T00:00:00.000Z").toISOString();
    await createRunningIntent(runRoot, "C-running-recent", { startedAt: recent });

    // Within 5s grace period: only 2s elapsed
    const result = reconcileStrandedCommands(runRoot, "coordinator", {
      gracePeriodMs: 5000,
      now: () => new Date("2026-01-01T00:00:02.000Z"),
    });

    expect(result.reconciled).toHaveLength(0);
    expect(result.stranded).toContain("C-running-recent");

    // Verify state was NOT modified
    const state = loadRun(runRoot, false).state;
    const cmd = (state.commands as Record<string, CommandRecord>)["C-running-recent"];
    expect(cmd.status).toBe("running");
    expect(cmd.exit_code).toBeNull();
  });

  it("preserves running command when process probe indicates live PID", async () => {
    const { runRoot } = await createTestFixture("stranded-live-pid");
    const past = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const cmd = await createRunningIntent(runRoot, "C-live-process", { startedAt: past });

    // Write valid attempt-started.json with PID
    const attemptDir = join(runRoot, "commands", cmd.id, "attempt-1");
    vfs.mkdirSync(attemptDir, { recursive: true });
    writeAttemptStarted(attemptDir, cmd.id, 1, past, cmd.environment![OWNERSHIP_ENV]!, lastSigner);

    const startedPath = join(attemptDir, "attempt-started.json");
    const started = JSON.parse(vfs.readFileSync(startedPath, "utf8") as string);
    started.root_pid_identity = { pid: 99999, start_time_token: "t1" };
    atomicWriteJson(startedPath, started, 0o600);

    // Even after grace period, live PID probe preserves it
    const result = reconcileStrandedCommands(runRoot, "coordinator", {
      gracePeriodMs: 1000,
      now: () => new Date("2026-01-01T00:10:00.000Z"),
      probeProcess: (identity) => (identity.pid === 99999 ? "live" : "absent"),
    });

    expect(result.reconciled).toHaveLength(0);
    expect(result.stranded).toContain("C-live-process");

    const state = loadRun(runRoot, false).state;
    expect((state.commands as Record<string, CommandRecord>)["C-live-process"].status).toBe(
      "running",
    );
  });

  it("reconciles stranded gate command with preflight_failure and repository_after: null", async () => {
    const { runRoot } = await createTestFixture("stranded-gate");
    const past = new Date("2026-01-01T00:00:00.000Z").toISOString();
    await createRunningIntent(runRoot, "C-gate-stranded", {
      startedAt: past,
      gateId: "gate-build",
      taskId: "task-1",
    });

    const result = reconcileStrandedCommands(runRoot, "coordinator", {
      gracePeriodMs: 1000,
      now: () => new Date("2026-01-01T00:05:00.000Z"),
    });

    expect(result.reconciled).toContain("C-gate-stranded");

    const state = loadRun(runRoot, false).state;
    const cmd = (state.commands as Record<string, CommandRecord>)["C-gate-stranded"];
    expect(cmd.status).toBe("failed");
    expect(cmd.exit_code).toBe(1);
    expect(cmd.failure_class).toBe("interrupted_or_lost");
    expect(cmd.preflight_failure).toBe("interrupted_or_lost");
    expect(cmd.repository_after).toBeNull();
  });
});
