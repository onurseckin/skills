import { describe, expect, test } from "bun:test";
import {
  appendReleaseFailureWarning,
  resolvePhaseCompletionResult,
  runExecCommand,
} from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../olt/scripts/src/runtime/agent-metadata.ts";
import { scratchRoot } from "../../support/scratch-root.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import { generateDefaultRepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";
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
