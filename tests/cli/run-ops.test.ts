import { describe, expect, spyOn, test } from "bun:test";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
  runArchiveCommand,
  runCompleteCommand,
  runConsolidateCommand,
  runExecCommand,
  runStatusCommand,
} from "../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import { createAgentMetadata, writeAgentMetadata } from "../../olt/scripts/src/runtime/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Flags } from "../../olt/scripts/src/cli/options.ts";
import { workflowPort } from "../../olt/scripts/src/integration/store-ports.ts";
import { generateDefaultRepoPolicy } from "../../olt/scripts/src/policy/repo-policy.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import * as completeRunModule from "../../olt/scripts/src/workflow/completion/complete-run.ts";
import * as autoSyncModule from "../../olt/scripts/src/workflow/completion/auto-sync-and-commit.ts";
import * as summaryModule from "../../olt/scripts/src/summary/formatters/index.ts";
import * as archivalModule from "../../olt/scripts/src/mind/archival/index.ts";
import type { WorkflowState } from "../../olt/scripts/src/workflow/types.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

async function initializeRun(label: string): Promise<{ repo: string; runRoot: string }> {
  const repo = scratchRoot(import.meta.path, label);
  const promptPath = join(repo, "prompt.txt");
  writeFileSync(promptPath, "runner metadata authority test", "utf-8");
  const initialized = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    `${label}-run`,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, runRoot: initialized.run_root as string };
}

function runFlags(runRoot: string, actor: string): Flags {
  return { run: runRoot, actor };
}

function gateRunFlags(runRoot: string, actor: string, task?: string, gate?: string): Flags {
  return {
    ...runFlags(runRoot, actor),
    ...(task === undefined ? {} : { task }),
    ...(gate === undefined ? {} : { gate }),
  };
}

function configureValidatedGateTask(runRoot: string, gateIds: readonly string[]): void {
  const port = workflowPort(runRoot);
  port.transact("test", "gate-run-setup", {}, (state) => {
    state.tasks["T-1"] = {
      id: "T-1",
      status: "validated",
      requirement_ids: ["R-1"],
      write_scope: ["src/owned"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
      report: { summary: "gate run fixture" },
      validations: [
        {
          validator_id: "validator",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-08-01T00:00:00.000Z",
          deadline_at: "2026-08-01T01:00:00.000Z",
          verdict: "pass",
          reviewed_requirement_ids: ["R-1"],
          checks: [],
        },
      ],
    };
    state.requirements = [
      { id: "R-1", status: "planned", evidence: [], disposition: "actionable", dependencies: [] },
    ];
    state.gates = gateIds.map((id) => ({
      id,
      command: ["echo", "gate"],
      cwd: ".",
      scope: "task",
      requirement_ids: ["R-1"],
      mandatory: true,
    }));
  });
}

function grantShellExecution(runRoot: string, actor: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role: "implementer",
      write_scope: ["src/"],
      can_execute_shell: true,
    }),
    runRoot,
  );
}

describe("runCompleteCommand", () => {
  test("captures rejected phase completion as a structured release failure", async () => {
    const result = await resolvePhaseCompletionResult(async () => {
      throw new Error("sync service unavailable");
    });

    expect(result).toEqual({
      synced: false,
      committed: false,
      pushed: false,
      error: "sync service unavailable",
    });
  });

  test("renders release failures as a concise completion warning", () => {
    expect(appendReleaseFailureWarning("### Run Complete", "sync service unavailable")).toBe(
      "### Run Complete\n- **Warning**: Release completion failed: sync service unavailable",
    );
    expect(appendReleaseFailureWarning("### Run Complete", undefined)).toBe("### Run Complete");
  });

  test("completes run lifecycle and captures auto sync release logs and warnings", async () => {
    const { runRoot } = await initializeRun("run-complete-lifecycle");
    const actor = "coordinator";
    grantShellExecution(runRoot, actor);

    const completeSpy = spyOn(completeRunModule, "completeRun").mockReturnValue({
      tasks: {
        "T-1": {
          id: "T-1",
          status: "done",
          requirement_ids: [],
          write_scope: ["."],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
        },
      },
      requirements: [],
      gates: [],
      commands: {},
      completion_result: {
        status: "complete",
        completed_at: new Date().toISOString(),
      },
    } as unknown as WorkflowState);

    const autoSyncSpy = spyOn(autoSyncModule, "executeAutoSyncAndCommit").mockResolvedValue({
      synced: false,
      committed: false,
      pushed: false,
      logs: ["[sync] failed to sync skills", "[commit] git clean failed"],
    });

    const summarySpy = spyOn(summaryModule, "generateSummarySuite").mockImplementation(() => {
      throw new Error("summary generation warning");
    });

    const pruneSpy = spyOn(archivalModule, "pruneCapsuleBoilerplate").mockReturnValue({
      runId: "run-complete-lifecycle-run",
      prunedDirectories: ["events-archive"],
      prunedFilesCount: 1,
      freedBytes: 1024,
    });

    const res = await runCompleteCommand({
      run: runRoot,
      actor,
      "auth-token": "test-token",
    });

    expect(res.run_root).toBe(runRoot);
    expect(res.summary_warning).toBe("summary generation warning");
    expect(res.pruned_subdirectories).toEqual(["events-archive"]);
    expect(String(res.markdown)).toContain("Warning");

    completeSpy.mockRestore();
    autoSyncSpy.mockRestore();
    summarySpy.mockRestore();
    pruneSpy.mockRestore();
  });
});

describe("runConsolidateCommand and runArchiveCommand", () => {
  test("runs consolidation command with dryRun and custom directory", () => {
    const consolidateSpy = spyOn(archivalModule, "consolidateCapsules").mockReturnValue({
      activeCapsules: [".olt/capsules/run-1"],
      archivedCapsules: [".olt/capsules/archive/run-0"],
      prunedSubdirectoriesCount: 3,
      archiveDir: ".olt/capsules/archive",
    });

    const res = runConsolidateCommand({
      repo: "/mock/repo",
      "capsules-dir": "/mock/repo/.olt/capsules",
      "dry-run": true,
    });

    expect(res.activeCapsules).toHaveLength(1);
    expect(res.archivedCapsules).toHaveLength(1);
    expect(String(res.markdown)).toContain("Capsule Consolidation Complete");

    consolidateSpy.mockRestore();
  });

  test("runs archive command with dryRun", () => {
    const archiveSpy = spyOn(archivalModule, "archiveCapsule").mockReturnValue({
      runId: "run-archive-1",
      sourcePath: ".olt/capsules/run-archive-1",
      archivedPath: ".olt/capsules/archive/run-archive-1",
      prunedDirectories: ["scratch", "tmp"],
    });

    const res = runArchiveCommand({
      run: ".olt/capsules/run-archive-1",
      "dry-run": true,
    });

    expect(res.runId).toBe("run-archive-1");
    expect(String(res.markdown)).toContain("Capsule Archived: `run-archive-1`");

    archiveSpy.mockRestore();
  });
});

describe("runStatusCommand", () => {
  test("reports detailed status across all possible task states and occupancy metrics", async () => {
    const { runRoot, repo } = await initializeRun("run-status-full");

    transact(runRoot, "coordinator", "setup-various-tasks", {}, (draft) => {
      draft.graph = { revision: 1 };
      draft.tasks = {
        "T-DONE": {
          id: "T-DONE",
          status: "done",
          label: "Completed Task",
          write_scope: ["src/done.ts"],
        },
        "T-SUBMITTED": {
          id: "T-SUBMITTED",
          status: "submitted",
          label: "Submitted Task",
          original_implementer: "worker-impl",
          write_scope: ["src/sub.ts"],
        },
        "T-LEASED": {
          id: "T-LEASED",
          status: "leased",
          label: "Leased Task",
          write_scope: ["src/leased.ts"],
          lease: {
            agent_id: "worker-1",
            role: "implementer",
          },
        },
        "T-VAL-ACTIVE": {
          id: "T-VAL-ACTIVE",
          status: "validating",
          label: "Active Validation Task",
          write_scope: ["src/val.ts"],
          validations: [
            {
              validator_id: "val-1",
              domain: "quality",
            },
          ],
        },
        "T-VAL-DONE": {
          id: "T-VAL-DONE",
          status: "validating",
          label: "Finished Validation Task",
          write_scope: ["src/val2.ts"],
          validations: [
            {
              validator_id: "val-2",
              domain: "security",
              verdict: "pass",
            },
          ],
        },
        "T-VAL-PENDING": {
          id: "T-VAL-PENDING",
          status: "validating",
          label: "Pending Probe Task",
          write_scope: ["src/val3.ts"],
          validations: [],
        },
        "T-READY": {
          id: "T-READY",
          status: "ready",
          label: "Ready Task",
          write_scope: ["src/ready.ts"],
        },
        "T-PROPOSED": {
          id: "T-PROPOSED",
          status: "proposed",
          label: "Blocked Task",
          write_scope: ["src/prop.ts"],
        },
        "T-REPAIR": {
          id: "T-REPAIR",
          status: "changes_requested",
          label: "Repair Task",
          write_scope: ["src/repair.ts"],
        },
        "T-UNKNOWN": {
          id: "T-UNKNOWN",
          status: "custom_status",
          label: "Unknown Status Task",
          write_scope: ["src/unk.ts"],
        },
      };
    });

    const statusRes = runStatusCommand({
      repo,
      run: runRoot,
      detailed: true,
    });

    expect(statusRes.run_root).toBe(runRoot);
    expect(statusRes.detailed).toBe(true);
    expect(statusRes.occupancy).toBeDefined();
    expect(String(statusRes.markdown)).toContain("Completed");
    expect(String(statusRes.markdown)).toContain("Leased");
    expect(String(statusRes.markdown)).toContain("Validating");
    expect(String(statusRes.markdown)).toContain("Standby (Ready)");
    expect(String(statusRes.markdown)).toContain("Repair Required");
  });
});

describe("runExecCommand durable metadata authority", () => {
  test("refuses worker and impl actor names without an exact durable grant", async () => {
    const { runRoot } = await initializeRun("run-exec-missing-grant");
    for (const actor of ["worker-auto", "impl-auto"]) {
      const metadataPath = join(runRoot, "runtime", `agent-${actor}.json`);
      expect(existsSync(metadataPath)).toBe(false);
      await expect(
        runExecCommand(runFlags(runRoot, actor), {}, ["echo", "must-not-run"]),
      ).rejects.toMatchObject({
        code: "ROLE_CONFINEMENT_VIOLATION",
      });
      expect(existsSync(metadataPath)).toBe(false);
    }
  });

  test("allows an exact run-scoped metadata grant and refuses again after it is removed", async () => {
    const { runRoot } = await initializeRun("run-exec-grant-revocation");
    const actor = "impl-durable-grant";
    const metadataPath = writeAgentMetadata(
      createAgentMetadata({
        agent_id: actor,
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    const result = await runExecCommand(runFlags(runRoot, actor), {}, ["echo", "granted"]);
    expect(result.exit_code).toBe(0);
    expect(result.command_id).toBeDefined();

    rmSync(metadataPath);
    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "revoked"]),
    ).rejects.toMatchObject({
      code: "ROLE_CONFINEMENT_VIOLATION",
    });
  });

  test("propagates corrupt exact metadata as integrity failure without creating a fallback grant", async () => {
    const { runRoot } = await initializeRun("run-exec-corrupt-grant");
    const actor = "worker-corrupt-grant";
    const metadataPath = join(runRoot, "runtime", `agent-${actor}.json`);
    mkdirSync(join(runRoot, "runtime"), { recursive: true });
    writeFileSync(metadataPath, "not-json", "utf-8");

    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "corrupt"]),
    ).rejects.toMatchObject({
      code: "INTEGRITY",
    });
    expect(existsSync(metadataPath)).toBe(true);
  });

  test("authorizes a durable run grant against the target repository policy", async () => {
    const { repo, runRoot } = await initializeRun("run-exec-target-policy");
    const actor = "impl-target-policy";
    writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({ ...generateDefaultRepoPolicy(repo), forbidden_commands: ["echo"] }),
    );
    writeAgentMetadata(
      createAgentMetadata({
        agent_id: actor,
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    await expect(
      runExecCommand(runFlags(runRoot, actor), {}, ["echo", "forbidden"]),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  test("supports custom cwd, tool flags, and command result capture", async () => {
    const { repo, runRoot } = await initializeRun("run-exec-cwd-flags");
    const actor = "impl-cwd-flags";
    grantShellExecution(runRoot, actor);

    const res = await runExecCommand(
      {
        ...runFlags(runRoot, actor),
        cwd: repo,
        tool: "shell",
        "tool-category": "system",
      },
      {},
      ["echo", "cwd test"],
    );

    expect(res.exit_code).toBe(0);
    expect(res.evidence).toBeDefined();
    expect(String(res.markdown)).toContain("echo cwd test");
  });
});

describe("runExecCommand task gate lifecycle", () => {
  async function setup(label: string, gates: readonly string[] = ["G-1"]) {
    const { run: runRoot } = await setupCompiledRun(label, []);
    const actor = "impl-gate-run";
    grantShellExecution(runRoot, actor);
    configureValidatedGateTask(runRoot, gates);
    return { runRoot, actor };
  }

  test("rejects task gate options before recording a command when the task or gate is invalid", async () => {
    const { runRoot, actor } = await setup("run-exec-preflight");

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "missing", "G-1"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "not-applicable"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, undefined, "G-1"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    workflowPort(runRoot).transact("test", "gate-run-ready", {}, (state) => {
      state.tasks["T-1"]!.status = "ready";
    });
    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    expect(readdirSync(join(runRoot, "commands"))).toEqual([]);
  });

  test("attaches each passed applicable gate and finishes only after the final gate", async () => {
    const { runRoot, actor } = await setup("run-exec-multiple-gates", ["G-1", "G-2"]);

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]),
    ).resolves.toMatchObject({ exit_code: 0 });
    expect(workflowPort(runRoot).read().tasks["T-1"]).toMatchObject({
      status: "gating",
      gate_results: [{ gate_id: "G-1", status: "passed" }],
    });

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-2"), {}, ["echo", "gate"]),
    ).resolves.toMatchObject({ exit_code: 0 });
    expect(workflowPort(runRoot).read().tasks["T-1"]).toMatchObject({ status: "done" });
  });

  test("preserves a durable receipt and rejects when an already-attached gate cannot be overwritten", async () => {
    const { runRoot, actor } = await setup("run-exec-attach-failure", ["G-1", "G-2"]);
    await runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]);

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const state = workflowPort(runRoot).read();
    expect(Object.keys(state.commands)).toHaveLength(2);
    expect(state.tasks["T-1"]!.gate_results).toHaveLength(1);
  });

  test("treats only a completed task's exact passed gate as idempotent", async () => {
    const { runRoot, actor } = await setup("run-exec-finished-idempotency");
    await runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]);

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "G-1"), {}, ["echo", "gate"]),
    ).resolves.toMatchObject({ exit_code: 0 });
    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1", "not-a-gate"), {}, ["echo", "gate"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  test("continues to record task-only non-gate evidence", async () => {
    const { runRoot, actor } = await setup("run-exec-task-only-evidence");

    await expect(
      runExecCommand(gateRunFlags(runRoot, actor, "T-1"), {}, ["echo", "evidence"]),
    ).resolves.toMatchObject({ exit_code: 0 });
    expect(Object.values(workflowPort(runRoot).read().commands)).toHaveLength(1);
  });
});
