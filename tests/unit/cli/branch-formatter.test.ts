import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/branch.ts";
import {
  formatBranchAbandonBrief,
  formatBranchClaimBrief,
  formatBranchCollectBrief,
  formatBranchOpenBrief,
  formatBranchStatusBrief,
  formatBranchSubmitBrief,
} from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/branch-formatter.ts";
import { formatDeterministicActionChaining } from "../../../orchestrating-long-tasks/scripts/src/cli/formatters/next-actions.ts";

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "task-1",
    parent_agent_id: "worker-1",
    reason: "the parser blocks the API change",
    depth: 1,
    status: "open",
    opened_at: "2026-08-19T10:00:00.000Z",
    sub_tasks: [
      {
        id: "S-1",
        label: "Fix the parser",
        write_scope: ["src/one/parser"],
        status: "claimed",
        agent_id: "sub-1",
        gate: "bun test parser",
      },
    ],
    ...overrides,
  };
}

describe("formatBranchOpenBrief", () => {
  test("names the frozen parent lease and gives dispatch and collect commands", () => {
    const brief = formatBranchOpenBrief(branch(), "run-1");

    expect(brief).toContain("### Branch Opened: B-1");
    expect(brief).toContain("`task-1` held by `worker-1` (now branched, lease frozen)");
    expect(brief).toContain("the parser blocks the API change");
    expect(brief).toContain("**Depth**: 1");
    expect(brief).toContain("branch:claim --run run-1 --branch B-1");
    expect(brief).toContain("branch:collect --run run-1 --branch B-1 --agent worker-1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts branch:claim --run run-1 --branch B-1 --sub-task S-1 --agent <SUB_AGENT>` [Sub-agent] — Claim sub-task under isolated scope",
    );
    expect(brief).toContain(
      '`bun harness.ts branch:collect --run run-1 --branch B-1 --agent worker-1 --token <PARENT_TOKEN> --summary "<SUMMARY>"` [Parent] — Collect branch once sub-tasks are submitted',
    );
  });
});

describe("formatBranchClaimBrief", () => {
  test("shows the claimed sub-task's scope, gate, lease, and submit command", () => {
    const record = branch();
    const subTask = record.sub_tasks[0]!;
    const brief = formatBranchClaimBrief(
      record,
      {
        ...subTask,
        lease: {
          agent_id: "sub-1",
          token_digest: "d".repeat(64),
          issued_at: "2026-08-19T10:00:00.000Z",
          expires_at: "2026-08-19T10:30:00.000Z",
          duration_seconds: 1800,
        },
      },
      "tok_abc",
      "run-1",
    );

    expect(brief).toContain("### Sub-task Claimed: S-1");
    expect(brief).toContain("`B-1` (depth 1) on `task-1`");
    expect(brief).toContain("`sub-1`");
    expect(brief).toContain("`src/one/parser`");
    expect(brief).toContain("`bun test parser`");
    expect(brief).toContain("**Lease Expires**: 2026-08-19T10:30:00.000Z");
    expect(brief).toContain("**Token**: `tok_abc`");
    expect(brief).toContain(
      "branch:submit --run run-1 --branch B-1 --sub-task S-1 --agent sub-1 --token tok_abc",
    );
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      '`bun harness.ts branch:submit --run run-1 --branch B-1 --sub-task S-1 --agent sub-1 --token tok_abc --summary "<SUMMARY>"` [Sub-agent] — Submit completed sub-task back to parent branch',
    );
  });

  test("an unassigned sub-task with no gate and no lease admits all three are unknown", () => {
    const record = branch();
    const subTask = {
      ...record.sub_tasks[0]!,
      agent_id: undefined,
      gate: undefined,
      lease: undefined,
    };
    const brief = formatBranchClaimBrief(record, subTask, "tok_abc", "run-1");

    expect(brief).toContain("**Agent**: `unknown`");
    expect(brief).toContain("**Gate**: none declared");
    expect(brief).toContain("**Lease Expires**: unknown");
    expect(brief).toContain("--agent <AGENT>");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      '`bun harness.ts branch:submit --run run-1 --branch B-1 --sub-task S-1 --agent <AGENT> --token tok_abc --summary "<SUMMARY>"` [Sub-agent] — Submit completed sub-task back to parent branch',
    );
  });
});

describe("formatBranchSubmitBrief", () => {
  test("lists sub-tasks still open by id and status", () => {
    const record = branch({
      sub_tasks: [
        { id: "S-1", label: "Fix parser", write_scope: ["src/a"], status: "submitted" },
        { id: "S-2", label: "Fix lexer", write_scope: ["src/b"], status: "claimed" },
      ],
    });

    const brief = formatBranchSubmitBrief(record, "S-1");

    expect(brief).toContain("### Sub-task Submitted: S-1");
    expect(brief).toContain("`B-1` on `task-1`");
    expect(brief).toContain("`S-2` (claimed)");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      '`bun harness.ts branch:collect --branch B-1 --agent worker-1 --token <PARENT_TOKEN> --summary "<SUMMARY>"` [Parent] — Collect submitted branch work',
    );
  });

  test("once nothing remains open, says the branch is ready to collect", () => {
    const record = branch({
      sub_tasks: [{ id: "S-1", label: "Fix parser", write_scope: ["src/a"], status: "submitted" }],
    });

    const brief = formatBranchSubmitBrief(record, "S-1");

    expect(brief).toContain("none - the branch is ready to collect");
  });

  test("an abandoned sub-task does not count as still open", () => {
    const record = branch({
      sub_tasks: [{ id: "S-1", label: "Fix parser", write_scope: ["src/a"], status: "abandoned" }],
    });

    expect(formatBranchSubmitBrief(record, "S-1")).toContain("ready to collect");
  });
});

describe("formatBranchCollectBrief", () => {
  test("renders an unmeasured repository as unknown, never as an empty change set", () => {
    const brief = formatBranchCollectBrief(branch(), "running");
    expect(brief).toContain("**Files Changed**: unknown (no repository observation)");
    expect(brief).toContain("`task-1` is now running with a fresh lease");
    expect(brief).toContain("**Outcome**: none recorded");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      '`bun harness.ts task:submit --task task-1 --agent worker-1 --token <TOKEN> --summary "<SUMMARY>"` [Parent] — Submit parent task with branch modifications integrated',
    );
  });

  test("distinguishes a measured empty change set from an unmeasured one", () => {
    const empty = formatBranchCollectBrief(
      branch({ files_changed: { value: [], evidence_class: "harness_observed" } }),
      "running",
    );
    expect(empty).toContain("no file changed (harness_observed)");

    const measured = formatBranchCollectBrief(
      branch({
        files_changed: { value: ["src/one/parser/a.ts"], evidence_class: "harness_observed" },
      }),
      "running",
    );
    expect(measured).toContain("1 files (harness_observed)");
    expect(measured).toContain("`src/one/parser/a.ts`");
  });

  test("lists at most ten files by name and summarises the rest as more", () => {
    const files = Array.from({ length: 13 }, (_, index) => `src/file-${index}.ts`);
    const brief = formatBranchCollectBrief(
      branch({ files_changed: { value: files, evidence_class: "harness_observed" } }),
      "running",
    );

    expect(brief).toContain("`src/file-0.ts`");
    expect(brief).toContain("`src/file-9.ts`");
    expect(brief).not.toContain("`src/file-10.ts`");
    expect(brief).toContain("... 3 more");
  });
});

describe("formatBranchStatusBrief", () => {
  test("says so plainly when nothing has branched", () => {
    const brief = formatBranchStatusBrief([], "run-1");
    expect(brief).toContain("none opened in this run");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts branch:open --run run-1 --parent-task <TASK_ID> --parent-agent <AGENT> --token <TOKEN>` [Parent] — Open branch to subdivide complex task",
    );
    expect(brief).toContain(
      "`bun harness.ts run:status --run run-1` [Orchestrator] — Check execution status",
    );
  });

  test("shows why every open branch exists, with its submitted count and file evidence", () => {
    const brief = formatBranchStatusBrief(
      [
        branch({
          status: "open",
          files_changed: { value: ["a.ts"], evidence_class: "harness_observed" },
        }),
      ],
      "run-1",
    );

    expect(brief).toContain("the parser blocks the API change");
    expect(brief).toContain("| `B-1` | `task-1` | 1 | open | 0/1 | 1 files (harness_observed) |");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts branch:open --run run-1 --parent-task <TASK_ID> --parent-agent <AGENT> --token <TOKEN>` [Parent] — Open branch to subdivide complex task",
    );
    expect(brief).toContain(
      "`bun harness.ts run:status --run run-1` [Orchestrator] — Check execution status",
    );
  });
});

describe("formatBranchAbandonBrief", () => {
  test("counts released sub-leases and records why the branch was abandoned", () => {
    const record = branch({
      outcome_summary: "the approach was a dead end",
      sub_tasks: [
        { id: "S-1", label: "Fix parser", write_scope: ["src/a"], status: "abandoned" },
        { id: "S-2", label: "Fix lexer", write_scope: ["src/b"], status: "claimed" },
      ],
    });

    const brief = formatBranchAbandonBrief(record, "leased");

    expect(brief).toContain("### Branch Abandoned: B-1");
    expect(brief).toContain("`task-1` is now leased with a fresh lease");
    expect(brief).toContain("the approach was a dead end");
    expect(brief).toContain("**Sub-leases Released**: 1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts task:heartbeat --task task-1 --agent worker-1 --token <TOKEN>` [Parent] — Refresh parent lease and resume work",
    );
  });

  test("an unresolved abandon admits it recorded no outcome", () => {
    const brief = formatBranchAbandonBrief(branch({ outcome_summary: undefined }), "leased");
    expect(brief).toContain("**Why Abandoned**: none recorded");
  });
});

describe("formatDeterministicActionChaining", () => {
  test("generates deterministic action chains for branch, task, plan, and queue stages", () => {
    const branchActions = formatDeterministicActionChaining("branch", { runId: "run-b" });
    expect(branchActions.join("\n")).toContain("bun harness.ts branch:open --run run-b");
    expect(branchActions.join("\n")).toContain("bun harness.ts branch:claim --run run-b");

    const taskActions = formatDeterministicActionChaining("task");
    expect(taskActions.join("\n")).toContain("bun harness.ts task:heartbeat --task <TASK_ID>");
    expect(taskActions.join("\n")).toContain("bun harness.ts task:submit --task <TASK_ID>");

    const planActions = formatDeterministicActionChaining("plan", { runId: "run-p" });
    expect(planActions.join("\n")).toContain("bun harness.ts plan:enhance --run run-p");
    expect(planActions.join("\n")).toContain("bun harness.ts plan:compile --run run-p");

    const queueActions = formatDeterministicActionChaining("queue", { runId: "run-q" });
    expect(queueActions.join("\n")).toContain("bun harness.ts queue:wave --run run-q");
    expect(queueActions.join("\n")).toContain("bun harness.ts queue:next --run run-q");
  });
});

