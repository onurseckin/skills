import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planAddCommand,
  planCompileCommand,
  planInitCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan.ts";
import { planReplanCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan-replan.ts";
import { partitionFindingsIntoScopes } from "../../../orchestrating-long-tasks/scripts/src/workflow/scope-partitioner.ts";
import { isJsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import type {
  GateRuntime,
  TaskRecord,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

const PROMPT = "Rebuild the drawer\nWire the store";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function compiledRun(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, PROMPT);
  const init = await planInitCommand({ repo, run: name, "prompt-file": promptPath });
  const run = init.run_root as string;
  planAddCommand({
    run,
    id: "task-drawer",
    label: "Drawer",
    scope: "src/components",
    gate: "bun test tests/drawer",
    actor: "planner",
  });
  planCompileCommand({ run, actor: "planner", "completion-gate": "bun test tests" });
  return run;
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "F-DRAWER-01",
    severity: "critical",
    file_paths: ["src/components/EdgeDrawer.tsx"],
    observation: "Toggle handler drops its callback",
    remediation: "Restore the callback",
    ...overrides,
  };
}

function repairTask(run: string, taskId: string): TaskRecord {
  const task = (loadRun(run).state.tasks as Record<string, TaskRecord>)[taskId];
  expect(task).toBeDefined();
  return task!;
}

function repairGate(run: string, taskId: string): GateRuntime {
  const state = loadRun(run).state;
  const gates = Array.isArray(state.gates) ? state.gates : [];
  const gate = gates.find((entry) => isJsonObject(entry) && entry.id === `gate-${taskId}`);
  expect(gate).toBeDefined();
  return gate as GateRuntime;
}

describe("plan:replan binds repair tasks to real gates", () => {
  test("inherits the gate and requirement of the planned task covering the scope", async () => {
    const run = await compiledRun("replan-inherit");
    const result = planReplanCommand({
      run,
      actor: "coordinator",
      findings: JSON.stringify([finding()]),
    });

    const taskId = (result.new_tasks as string[])[0]!;
    expect(repairGate(run, taskId).command).toEqual(["bun", "test", "tests/drawer"]);
    const task = repairTask(run, taskId);
    expect(task.requirement_ids).toEqual(["req-drawer"]);
    expect(task.findings![0]!.revalidation).toBe("bun test tests/drawer");
    expect(task.findings![0]!.requirement_id).toBe("req-drawer");
    expect(String(result.markdown)).toContain(
      "Gate `bun test tests/drawer` (inherited from the planned task gating this scope)",
    );
  });

  test("--gate wins over every derivation and is recorded verbatim", async () => {
    const run = await compiledRun("replan-flag-gate");
    const result = planReplanCommand({
      run,
      actor: "coordinator",
      gate: "bun run typecheck",
      findings: JSON.stringify([finding()]),
    });

    const taskId = (result.new_tasks as string[])[0]!;
    expect(repairGate(run, taskId).command).toEqual(["bun", "run", "typecheck"]);
    expect(String(result.markdown)).toContain("Gate `bun run typecheck` (declared by `--gate`)");
  });

  test("a finding may declare its own revalidation_gate", async () => {
    const run = await compiledRun("replan-finding-gate");
    const result = planReplanCommand({
      run,
      actor: "coordinator",
      findings: JSON.stringify([finding({ revalidation_gate: "bun test tests/toggle" })]),
    });

    const taskId = (result.new_tasks as string[])[0]!;
    expect(repairGate(run, taskId).command).toEqual(["bun", "test", "tests/toggle"]);
    expect(String(result.markdown)).toContain(
      "Gate `bun test tests/toggle` (declared by the findings)",
    );
  });

  test("refuses to invent a gate when nothing supplies one", async () => {
    const run = await compiledRun("replan-no-gate");
    expect(() =>
      planReplanCommand({
        run,
        actor: "coordinator",
        findings: JSON.stringify([
          finding({
            requirement_id: "req-drawer",
            file_paths: ["src/engine/layout/hierarchical.ts"],
          }),
        ]),
      }),
    ).toThrow(/has no revalidation gate/);
    // Nothing reached the ledger: the run is still at its compiled revision.
    expect(loadRun(run).state.graph_revision).toBeUndefined();
  });

  test("refuses when findings disagree about the gate", async () => {
    const run = await compiledRun("replan-gate-conflict");
    expect(() =>
      planReplanCommand({
        run,
        actor: "coordinator",
        findings: JSON.stringify([
          finding({ revalidation_gate: "bun test tests/a" }),
          finding({ id: "F-DRAWER-02", revalidation_gate: "bun test tests/b" }),
        ]),
      }),
    ).toThrow(/different revalidation gates/);
  });

  test("recorded critic prose is never promoted to a gate command", async () => {
    const run = await compiledRun("replan-prose");
    const result = planReplanCommand({
      run,
      actor: "coordinator",
      findings: JSON.stringify([finding({ revalidation: "Re-run full verification gate." })]),
    });
    const taskId = (result.new_tasks as string[])[0]!;
    expect(repairGate(run, taskId).command).toEqual(["bun", "test", "tests/drawer"]);
  });

  test("--gate must name a command", async () => {
    const run = await compiledRun("replan-blank-gate");
    expect(() =>
      planReplanCommand({
        run,
        actor: "coordinator",
        gate: "   ",
        findings: JSON.stringify([finding()]),
      }),
    ).toThrow(/--gate/);
  });
});

describe("plan:replan binds repair findings to real requirements", () => {
  test("rejects a requirement id the run never recorded", async () => {
    const run = await compiledRun("replan-unknown-req");
    expect(() =>
      planReplanCommand({
        run,
        actor: "coordinator",
        gate: "bun run typecheck",
        findings: JSON.stringify([finding({ requirement_id: "req-imaginary" })]),
      }),
    ).toThrow(/which this run has not recorded/);
  });

  test("rejects a finding with no requirement to declare or inherit", async () => {
    const run = await compiledRun("replan-unbound-req");
    expect(() =>
      planReplanCommand({
        run,
        actor: "coordinator",
        gate: "bun run typecheck",
        findings: JSON.stringify([finding({ file_paths: ["src/engine/layout/hierarchical.ts"] })]),
      }),
    ).toThrow(/declares no requirement_id/);
  });
});

describe("the scope partitioner mints no gate of its own", () => {
  test("a repair cluster carries scope and findings, and no invented command", () => {
    const [cluster] = partitionFindingsIntoScopes(
      [
        {
          id: "F-DRAWER-01",
          severity: "critical",
          file_paths: ["src/components/EdgeDrawer.tsx"],
          observation: "Toggle handler drops its callback",
          remediation: "Restore the callback",
        },
      ],
      1,
    );
    expect(cluster).toBeDefined();
    expect(Object.keys(cluster!).sort()).toEqual([
      "effort",
      "findings",
      "label",
      "taskId",
      "writeScope",
    ]);
  });
});
