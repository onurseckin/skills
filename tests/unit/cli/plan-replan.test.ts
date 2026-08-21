import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planReplanCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan-replan.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { proposeBatch } from "../../../orchestrating-long-tasks/scripts/src/scheduler/propose-batch.ts";
import {
  initRun,
  loadRun,
  transact,
} from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { finishTask } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/finish-task.ts";
import { applicableGates } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/gate-policy.ts";
import type { Flags } from "../../../orchestrating-long-tasks/scripts/src/cli/options.ts";

/**
 * Seeds a run whose graph, requirements and tasks look exactly like what plan:compile would have
 * produced for two disjoint tasks (task-a/req-a, task-b/req-b) — bypassing plan:add/plan:compile
 * themselves (out of scope here) so each test starts from a known-valid, already-compiled revision 1.
 */
function seedCompiledRun(): { runRoot: string; repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "plan-replan-test-"));
  mkdirSync(join(repoRoot, "src", "a"), { recursive: true });
  mkdirSync(join(repoRoot, "src", "b"), { recursive: true });
  const runRoot = initRun(
    repoRoot,
    "r1",
    new TextEncoder().encode("Implement A.\nImplement B.\n"),
    "file",
    true,
  );

  const requirements = {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: "test",
    requirements: [taskRequirement("req-a", "task-a"), taskRequirement("req-b", "task-b")],
    dispositions: [],
  };

  const graph = {
    schema: "harness.graph",
    version: 1,
    revision: 1,
    nodes: [
      { id: "node-req-a", type: "requirement", label: "req-a", requirement_id: "req-a" },
      { id: "node-req-b", type: "requirement", label: "req-b", requirement_id: "req-b" },
      taskNode("task-a", "req-a", "src/a", 1),
      { id: "artifact-a", type: "artifact", label: "Artifact for A" },
      taskNode("task-b", "req-b", "src/b", 2),
      { id: "artifact-b", type: "artifact", label: "Artifact for B" },
    ],
    edges: [
      { source: "task-a", target: "artifact-a", type: "produces" },
      { source: "task-b", target: "artifact-b", type: "produces" },
    ],
    gates: [
      gate("gate-a", ["bun", "test", "tests/a.test.ts"], "req-a"),
      gate("gate-b", ["bun", "test", "tests/b.test.ts"], "req-b"),
      {
        id: "gate-run-completion",
        command: ["bun", "test", "tests"],
        cwd: ".",
        scope: "run",
        requirement_ids: [],
        mandatory: true,
      },
    ],
  };

  transact(runRoot, "planner", "test-seed", {}, (draft) => {
    draft.requirements = requirements;
    draft.graph = graph;
    draft.graph_revision = 1;
    draft.plan_history = [];
    draft.tasks = {
      "task-a": runtimeTask("task-a", "req-a", "src/a", 1),
      "task-b": runtimeTask("task-b", "req-b", "src/b", 2),
    };
  });

  return { runRoot, repoRoot };
}

function taskRequirement(id: string, taskId: string): Record<string, unknown> {
  return {
    id,
    source_lines: [1],
    source_excerpt: "x",
    instruction: `Implement ${taskId}`,
    implementation: `Implement ${taskId}`,
    subsystem: "runtime/planning",
    acceptance: [
      {
        id: `crit-${id}-1`,
        criterion: "gate passes",
        evidence: [`Gate execution output for ${taskId}`],
      },
    ],
    candidate_gates: [{ argv: ["bun", "test"], cwd: "." }],
    priority: 50,
    risk: "medium",
    ambiguity: [],
    dependencies: [],
    disposition: "actionable",
    status: "planned",
  };
}

function taskNode(
  id: string,
  requirementId: string,
  scope: string,
  createdOrder: number,
): Record<string, unknown> {
  return {
    id,
    type: "task",
    label: id,
    requirement_ids: [requirementId],
    write_scope: [scope],
    resource_scope: [],
    artifact_ids: [`artifact-${id.replace(/^task-/, "")}`],
    status: "ready",
    priority: 50,
    effort: 3,
    created_order: createdOrder,
  };
}

function runtimeTask(
  id: string,
  requirementId: string,
  scope: string,
  createdOrder: number,
): Record<string, unknown> {
  return {
    id,
    type: "task",
    label: id,
    requirement_ids: [requirementId],
    write_scope: [scope],
    resource_scope: [],
    artifact_ids: [`artifact-${id.replace(/^task-/, "")}`],
    status: "ready",
    priority: 50,
    effort: 3,
    created_order: createdOrder,
    dependencies: [],
    history: [],
  };
}

function gate(id: string, command: string[], requirementId: string): Record<string, unknown> {
  return {
    id,
    command,
    cwd: ".",
    scope: "task",
    requirement_ids: [requirementId],
    mandatory: true,
  };
}

function writeFindingsFile(repoRoot: string, findings: Record<string, unknown>[]): string {
  const path = join(repoRoot, "findings.json");
  writeFileSync(path, JSON.stringify(findings), "utf-8");
  return path;
}

function replanFlags(overrides: Record<string, string>): Flags {
  return { run: overrides.run!, actor: overrides.actor ?? "coordinator", ...overrides } as Flags;
}

describe("plan:replan", () => {
  test("a replan-created task is derived like graph/compiler.ts, gated where applicableGates reads it, and reachable by the scheduler", () => {
    const { runRoot, repoRoot } = seedCompiledRun();
    const findingsPath = writeFindingsFile(repoRoot, [
      {
        id: "F-1",
        // Declared explicitly rather than inherited by scope overlap, so this finding's own
        // (disjoint, brand-new) write scope does not have to collide with an existing task's scope
        // for the binding resolver to accept it.
        requirement_id: "req-b",
        severity: "important",
        file_paths: ["src/c/thing.ts"],
        observation: "off-by-one in the shared helper",
        remediation: "fix the loop bound",
        revalidation_gate: "bun test tests/c-repair.test.ts",
      },
    ]);

    const result = planReplanCommand(
      replanFlags({ run: runRoot, "findings-file": findingsPath, round: "2" }),
    );
    expect(result.revision).toBe(2);
    expect(result.new_tasks).toEqual(["repair-R2-src-c"]);

    const state = loadRun(runRoot).state as Record<string, unknown>;
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    const repairTask = tasks["repair-R2-src-c"];
    expect(repairTask).toBeDefined();

    // Derived the way graph/compiler.ts derives them for a fresh compile, not left undefined.
    expect(repairTask!.priority).toBe(50);
    expect(repairTask!.effort).toBeGreaterThanOrEqual(1);
    expect(repairTask!.created_order).toBe(3);
    expect(repairTask!.repair_round).toBe(2);
    expect(Array.isArray(repairTask!.findings)).toBe(true);
    expect((repairTask!.findings as unknown[]).length).toBe(1);

    // The gate lives where applicableGates actually looks (graph.gates), not the top-level `gates`
    // field the workflow layer never reads.
    const graph = state.graph as Record<string, unknown>;
    const graphGates = graph.gates as Record<string, unknown>[];
    expect(graphGates.some((g) => g.id === "gate-repair-R2-src-c")).toBe(true);
    expect(Array.isArray(state.gates)).toBe(false);

    // The exact regression this fix closes: scheduler/propose-batch.ts's taskRecord() type guard
    // used to silently drop a task with no priority/created_order/effort. It no longer does.
    const batch = proposeBatch(state, null);
    expect(batch.map((t) => t.id)).toContain("repair-R2-src-c");
  });

  test("the replan-created task's gate is actually enforced at task:finish", () => {
    const { runRoot, repoRoot } = seedCompiledRun();
    const findingsPath = writeFindingsFile(repoRoot, [
      {
        id: "F-2",
        requirement_id: "req-b",
        severity: "important",
        file_paths: ["src/c/thing.ts"],
        observation: "off-by-one in the shared helper",
        remediation: "fix the loop bound",
        revalidation_gate: "bun test tests/c-repair.test.ts",
      },
    ]);
    planReplanCommand(replanFlags({ run: runRoot, "findings-file": findingsPath, round: "2" }));

    const taskId = "repair-R2-src-c";
    const port = workflowPort(runRoot);

    // Make the repair task otherwise finish-ready: its own findings resolved, a report on file, and
    // an independent code-quality pass recorded — everything finishTask demands *except* the gate.
    port.transact("validator-1", "test-prime", {}, (draft) => {
      const task = draft.tasks[taskId]!;
      task.status = "validated";
      task.report = { summary: "fixed" };
      for (const finding of task.findings ?? []) finding.status = "resolved";
      task.validations = [
        {
          validator_id: "validator-1",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: new Date().toISOString(),
          deadline_at: new Date().toISOString(),
          verdict: "pass",
        },
      ];
    });

    // Without any passing gate record at all, finishTask refuses.
    try {
      finishTask(port, taskId, "coordinator");
      throw new Error("expected finishTask to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("mandatory task gates have not passed");
    }

    // The repair task inherited req-b (it exists to close a finding against that same
    // requirement), so applicableGates correctly returns *both* the mandatory gate that req-b
    // already carried (gate-b) and this command's own new one — sharing a requirement id really
    // does mean sharing its gate set, for every task that carries that id.
    const preFinishState = port.read();
    expect(applicableGates(preFinishState, preFinishState.tasks[taskId]!).map((g) => g.id)).toEqual(
      ["gate-b", "gate-repair-R2-src-c"],
    );

    // Passing the *inherited* gate alone is not enough — the gate this command minted is still
    // consulted on its own, proving it was not silently dropped or aliased onto an existing one.
    port.transact("coordinator", "test-gate-pass-partial", {}, (draft) => {
      const task = draft.tasks[taskId]!;
      task.gate_results = [{ gate_id: "gate-b", command_id: "C-fake-b", status: "passed" }];
    });
    try {
      finishTask(port, taskId, "coordinator");
      throw new Error("expected finishTask to still refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).message).toContain("mandatory task gates have not passed");
    }

    // Record the repair gate's own pass too and finish again — now it succeeds.
    port.transact("coordinator", "test-gate-pass", {}, (draft) => {
      const task = draft.tasks[taskId]!;
      task.gate_results = [
        { gate_id: "gate-b", command_id: "C-fake-b", status: "passed" },
        { gate_id: "gate-repair-R2-src-c", command_id: "C-fake", status: "passed" },
      ];
    });

    const finished = finishTask(port, taskId, "coordinator");
    expect(finished.tasks[taskId]!.status).toBe("done");
  });

  test("refuses rather than silently corrupting state when a repair gate would retroactively change an already-active task's gate set", () => {
    const { runRoot, repoRoot } = seedCompiledRun();

    // Move task-a into "active" territory (guardPlanRevision freezes it from here on).
    transact(runRoot, "coordinator", "test-activate", {}, (draft) => {
      const tasks = draft.tasks as Record<string, Record<string, unknown>>;
      tasks["task-a"]!.status = "leased";
    });

    // This finding inherits req-a by scope overlap with task-a, which is now active/frozen.
    const findingsPath = writeFindingsFile(repoRoot, [
      {
        id: "F-3",
        severity: "important",
        file_paths: ["src/a/index.ts"],
        observation: "task-a's own fix regressed",
        remediation: "fix it",
        revalidation_gate: "bun test tests/a-repair.test.ts",
      },
    ]);

    // guardPlanRevision itself is the refusal: sharing a requirement id with an already-active task
    // means sharing that task's gate set too (applicableGates has no other way to bind a gate to a
    // task), so a genuinely new gate on that requirement always reads as "task-a's gates changed" —
    // guardPlanRevision correctly refuses rather than let that go through unnoticed.
    expect(() =>
      planReplanCommand(replanFlags({ run: runRoot, "findings-file": findingsPath, round: "2" })),
    ).toThrow(/plan revision cannot change active task task-a gates/);

    // Nothing was left half-written: the run is still on revision 1 and task-a's record is intact.
    const state = loadRun(runRoot).state as Record<string, unknown>;
    const graph = state.graph as Record<string, unknown>;
    expect(graph.revision).toBe(1);
  });
});
