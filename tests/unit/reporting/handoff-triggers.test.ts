import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  refreshHandoff,
  refreshHandoffOnEscalation,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { commandRecord, TEST_GATE_ARGV } from "../workflow/test-port.ts";

const roots: string[] = [];
const SOURCE = new URL("../../../orchestrating-long-tasks/scripts/src/", import.meta.url);

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

function handoffPath(run: string): string {
  return join(run, "handoff.md");
}

/** A compiled single-task capsule whose one task is claimed and whose gate evidence is recorded. */
async function capsule(name: string, config?: Record<string, number>) {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  if (config) await writeFile(join(repo, "harness.config.json"), JSON.stringify(config));
  const run = initRun(repo, name, new TextEncoder().encode("Ship the parser"), "file", true);
  transact(run, "planner", "plan-applied", {}, (state) => {
    state.graph = {
      revision: 1,
      gates: [
        {
          id: "G-1",
          command: TEST_GATE_ARGV,
          cwd: ".",
          scope: "task",
          requirement_ids: ["R-1"],
          mandatory: true,
        },
      ],
    };
    state.requirements = {
      requirements: [{ id: "R-1", disposition: "actionable", status: "planned", evidence: [] }],
    };
    state.tasks = {
      "task-1": {
        id: "task-1",
        status: "ready",
        requirement_ids: ["R-1"],
        dependencies: [],
        write_scope: ["src"],
        attempts: [],
        history: [],
        repair_round: 0,
      },
    };
  });
  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    "task-1",
    "--agent",
    "worker-1",
    "--role",
    "implementer",
  ]);
  transact(run, "test", "fixture-prepared", {}, (state) => {
    const commands = (state.commands ?? {}) as Record<string, unknown>;
    commands["C-1"] = commandRecord("C-1", {
      actor: "worker-1",
      task_id: "task-1",
      gate_id: null,
    });
    commands["C-VAL"] = commandRecord("C-VAL", {
      actor: "val-1",
      task_id: "task-1",
      gate_id: "G-1",
    });
    state.commands = commands;
  });
  return { repo, run, token: String(claim.token) };
}

async function submit(run: string, token: string) {
  return execute([
    "task:submit",
    "--run",
    run,
    "--task",
    "task-1",
    "--agent",
    "worker-1",
    "--token",
    token,
    "--files-changed",
    "src/parser.ts",
    "--evidence",
    "C-1",
    "--summary",
    "Rewrote the parser",
  ]);
}

describe("the restart document is written where a run can be lost", () => {
  test("task submission writes it, and the CLI reports where", async () => {
    const { run, token } = await capsule("handoff-submit");
    expect(existsSync(handoffPath(run))).toBeFalse();

    const result = await submit(run, token);

    expect(result.handoff_path).toBe(handoffPath(run));
    const document = readFileSync(handoffPath(run), "utf-8");
    expect(document).toContain("# Harness handoff");
    expect(document).toContain('"id":"task-1","status":"submitted"');
    expect(document).toContain('"task:validate-start"');
    // Derived, and marked as such on disk: a reader must not be able to edit it into evidence.
    expect(statSync(handoffPath(run)).mode & 0o777).toBe(0o444);
  });

  async function rejectOnce(name: string, maxRepairRounds: number) {
    const { run, token } = await capsule(name, { max_repair_rounds: maxRepairRounds });
    await submit(run, token);
    const validation = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      "task-1",
      "--validator",
      "val-1",
    ]);
    rmSync(handoffPath(run), { force: true });
    const rejected = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      "task-1",
      "--validator",
      "val-1",
      "--token",
      String(validation.token),
      "--evidence",
      "C-VAL",
      "--reason",
      "an empty payload still parses",
      "--severity",
      "critical",
      "--remediation",
      "Reject an empty payload before the parse",
    ]);
    return { run, rejected };
  }

  test("escalation writes it", async () => {
    const { run, rejected } = await rejectOnce("handoff-escalate", 1);

    expect((rejected.task as { status: string }).status).toBe("escalated");
    expect(rejected.handoff_path).toBe(handoffPath(run));
    expect(readFileSync(handoffPath(run), "utf-8")).toContain('"id":"task-1","status":"escalated"');
  });

  test("a rejection inside the repair budget is not an escalation, and writes nothing", async () => {
    const { run, rejected } = await rejectOnce("handoff-repairable", 2);

    expect((rejected.task as { status: string }).status).toBe("changes_requested");
    expect(rejected.handoff_path).toBeUndefined();
    expect(existsSync(handoffPath(run))).toBeFalse();
  });

  test("regenerating replaces the read-only document it wrote before", async () => {
    const { run, token } = await capsule("handoff-rewrite");
    await submit(run, token);
    const first = readFileSync(handoffPath(run), "utf-8");

    expect(refreshHandoff(run)).toBe(handoffPath(run));
    const second = readFileSync(handoffPath(run), "utf-8");

    expect(second).toBe(first);
    expect(statSync(handoffPath(run)).mode & 0o777).toBe(0o444);
  });

  test("a capsule it cannot render costs the caller nothing", () => {
    expect(refreshHandoff(join(tmpdir(), "harness-handoff-absent"))).toBeUndefined();
  });

  test("only an escalated task triggers the escalation write", () => {
    const absent = join(tmpdir(), "harness-handoff-absent");
    expect(refreshHandoffOnEscalation(absent, "changes_requested")).toBeUndefined();
    expect(refreshHandoffOnEscalation(absent, "done")).toBeUndefined();
  });

  test("every trigger the run depends on still has its call site", async () => {
    const wiring: Record<string, string> = {
      "cli/commands/run-ops.ts": "refreshHandoff(run)",
      "cli/commands/task-claim.ts": "refreshHandoff(run)",
      "cli/commands/task-review.ts": "refreshHandoffOnEscalation(run,",
      "cli/commands/task-reject.ts": "refreshHandoffOnEscalation(run,",
    };
    for (const [file, call] of Object.entries(wiring)) {
      const source = readFileSync(new URL(file, SOURCE), "utf-8");
      expect(source).toContain(call);
    }
  });
});
