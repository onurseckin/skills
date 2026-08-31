import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { GraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import { emptyState, tempRoot } from "./markdown-fixtures-core.ts";

/**
 * Everything a run can record, present at once: the report has to render each of these from the
 * capsule rather than from a happy path that only ever sees the fields the last test remembered.
 */
export function populatedRunRoot(): string {
  const root = tempRoot();
  mkdirSync(join(root, "planning"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(
    join(root, "planning", "enhanced-plan.json"),
    JSON.stringify({
      schema: "harness.enhanced-plan",
      version: 1,
      run_id: "unit-run",
      prompt_sha256: "abc123",
      derived_from: "prompt.md",
      authoritative: false,
      recorded_at: "2026-08-20T00:00:00.000Z",
      actor: "planner-1",
      summary: { value: "Two subsystems", evidence_class: "agent_reported" },
      observations: [{ value: "src has no tests", evidence_class: "agent_reported" }],
      todos: [{ id: "todo-1", text: "Add parser tests", evidence_class: "agent_reported" }],
      risks: [{ value: "The rewrite may regress", evidence_class: "agent_reported" }],
      open_questions: [{ value: "Which grammar", evidence_class: "agent_reported" }],
      sources: [{ value: "src/one.ts", evidence_class: "agent_reported" }],
    }),
  );
  writeFileSync(
    join(root, "reports", "critic-review.json"),
    JSON.stringify({
      critic: "critic-1",
      decision: "approve",
      summary: "The whole diff is proven",
      created_at: "2026-08-20T01:00:00.000Z",
    }),
  );
  return root;
}

export const populatedState: JsonObject = {
  ...emptyState,
  graph: {
    revision: 4,
    gates: [
      {
        id: "gate-1",
        scope: "task",
        command: ["bun", "gate.ts"],
        mandatory: true,
        requirement_ids: ["req-1"],
      },
      { id: "gate-run", scope: "run", command: "bun test", mandatory: true, requirement_ids: [] },
    ],
  },
  requirements: {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: "abc123",
    requirements: [
      {
        id: "req-1",
        status: "satisfied",
        disposition: "actionable",
        source_lines: [1, 2],
        instruction: "Do the thing",
        subsystem: "runtime",
        risk: "medium",
        priority: 50,
        dependencies: [],
        acceptance: [{ id: "crit-1", criterion: "the gate passes" }, { id: "crit-2" }],
        evidence: ["task:task-1"],
      },
      { status: "planned" },
    ],
    dispositions: [
      { line: 1, kind: "requirement", requirement_id: "req-1" },
      { line: 2, kind: "context", rationale: "background" },
    ],
  },
  commands: {
    "C-1": {
      id: "C-1",
      argv: ["bun", "gate.ts"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "task-1",
      gate_id: "gate-1",
      started_at: "2026-08-20T00:00:00.000Z",
      finished_at: "2026-08-20T00:00:02.000Z",
      exit_code: 0,
      signal: null,
      fingerprint: "f",
      attempt_signing_public_key: "k",
      record_path: "commands/C-1/record.json",
      actor: "validator-1",
      logs: {
        stdout: { path: "out.log", bytes: 12, sha256: "a" },
        stderr: { path: "err.log", bytes: 0, sha256: "b" },
      },
    },
    "C-2": {
      id: "C-2",
      argv: ["bun", "-e", "process.exit(2)"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "failed",
      task_id: null,
      gate_id: null,
      started_at: "2026-08-20T00:00:03.000Z",
      finished_at: "not-a-date",
      exit_code: 2,
      signal: null,
      fingerprint: "f2",
      attempt_signing_public_key: "k",
      record_path: "commands/C-2/record.json",
      actor: "coordinator-1",
    },
  },
  task_order: ["task-1"],
  tasks: {
    "task-1": {
      id: "task-1",
      label: "First",
      status: "done",
      requirement_ids: ["req-1"],
      write_scope: ["src/one"],
      dependencies: [],
      attempts: [],
      history: [
        {
          at: "2026-08-20T00:00:00.000Z",
          actor: "worker-1",
          from: "ready",
          to: "leased",
          reason: "claimed",
          attempt: 1,
        },
      ],
      repair_round: 1,
      probe_round: 1,
      original_implementer: "worker-1",
      repair_assignee: "worker-1",
      report: {
        summary: "Done",
        files_changed: ["src/one/index.ts"],
        files_changed_evidence_class: "harness_observed",
      },
      gate_results: [{ gate_id: "gate-1", command_id: "C-1", status: "passed" }],
      validations: [
        {
          validator_id: "validator-2",
          domain: "code-quality",
          token_digest: "d",
          attempt: 2,
          started_at: "2026-08-20T00:00:04.000Z",
          deadline_at: "2026-08-20T01:00:04.000Z",
          verdict: "pass",
          checks: [{ command_id: "C-1" }],
        },
      ],
      validation_history: [
        {
          validator_id: "validator-1",
          token_digest: "d",
          attempt: 1,
          started_at: "2026-08-20T00:00:01.000Z",
          deadline_at: "2026-08-20T01:00:01.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "probe-1",
          class: "probe_demand",
          requirement_id: "req-1",
          severity: "minor",
          observation: "Prove it",
          evidence: [],
          remediation: "Answer",
          revalidation: "cite a command",
          status: "resolved",
          probe_round: 1,
          resolved_by: "validator-2",
          revalidation_proof: {
            method: "probe_demand_answered",
            evidence: [{ command_id: "C-1" }, "not-an-evidence-object"],
          },
        },
      ],
    },
  },
  agents: [
    {
      id: "worker-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: "task-1",
      host: "claude-code",
      granted_at: "2026-08-20T00:00:00.000Z",
      status: "active",
      report_count: 2,
      last_reported_at: "2026-08-20T00:00:05.000Z",
      tokens_in: { value: 900, evidence_class: "host_reported" },
      tokens_out: { value: 120, evidence_class: "host_reported" },
      tools_used: [
        {
          name: "Bash",
          category: "shell",
          evidence_class: "agent_reported",
          first_reported_at: "2026-08-20T00:00:05.000Z",
        },
      ],
    },
  ],
  branches: [
    {
      id: "B-1",
      parent_task_id: "task-1",
      parent_agent_id: "worker-1",
      reason: "the parser had to move first",
      depth: 1,
      status: "collected",
      opened_at: "2026-08-20T00:00:00.000Z",
      collected_at: "2026-08-20T00:00:06.000Z",
      outcome_summary: "parser landed",
      files_changed: { value: ["src/one/parser.ts"], evidence_class: "harness_observed" },
      collected_observation: {
        observed_at: "2026-08-20T00:00:06.000Z",
        git_available: true,
        head: "abc",
        entries: [{ path: "src/one/parser.ts", status_code: "M", sha256: "s" }],
      },
      sub_tasks: [
        {
          id: "S-1",
          label: "Move the parser",
          write_scope: ["src/one/parser"],
          gate: "bun gate.ts",
          status: "submitted",
          agent_id: "sub-1",
          summary: "moved",
        },
      ],
    },
  ],
};

/**
 * The graph `generateGraphDataset` would have computed for `populatedState` — `task-1`'s own file
 * on `node-task-task-1`, `B-1`'s Git-observed file on its section.
 */
export const populatedGraph: GraphDataset = {
  id: "unit-run-graph",
  title: "unit-run-graph",
  nodes: [
    {
      id: "node-task-task-1",
      name: "First",
      files: [
        {
          path: "src/one/index.ts",
          mode: "write",
          evidence_class: "harness_observed",
          lines: "1-4",
          additions: 3,
          deletions: 1,
          step: 12,
          rationale: "Implemented the parser rewrite",
        },
      ],
    },
  ],
  edges: [],
  sections: [
    {
      id: "section-branch-B-1",
      title: "Branch of task-1",
      nodeIds: [],
      files: [{ path: "src/one/parser.ts", mode: "write", evidence_class: "harness_observed" }],
    },
  ],
};
