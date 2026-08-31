import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runExecCommand } from "../../../../olt/scripts/src/cli/commands/run-ops.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { cleanupRoots } from "../../commands/fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../commands/fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
});

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

describe("runExecCommand task gate lifecycle", () => {
  async function setup(label: string, gates: readonly string[] = ["G-1"]) {
    const { run: runRoot } = await setupCompiledRun(label, roots);
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
