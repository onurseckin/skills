import { describe, expect, test } from "bun:test";
import type { BranchRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { makeGrant, makeState, makeTask } from "../dag/graph-fixtures.ts";

function withRawValidations(task: TaskRecord, rawValidations: unknown[]): TaskRecord {
  return { ...task, validations: rawValidations } as unknown as TaskRecord;
}

describe("a validator node's domain distinguishes it from every other validator", () => {
  test("two validators in different domains render with different names and metadata", () => {
    const securityTask = makeTask("T-sec", {
      status: "validating",
      validations: [
        {
          validator_id: "val-sec",
          domain: "security",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
        },
      ],
    });
    const uiTask = makeTask("T-ui", {
      status: "validating",
      validations: [
        {
          validator_id: "val-ui",
          domain: "ui-design",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-domains",
      state: makeState([securityTask, uiTask]),
    });

    const securityNode = dataset.nodes.find((node) => node.id === "node-validator-T-sec");
    const uiNode = dataset.nodes.find((node) => node.id === "node-validator-T-ui");

    expect(securityNode?.name).toBe("Validator (security): val-sec");
    expect(uiNode?.name).toBe("Validator (ui-design): val-ui");
    expect(securityNode?.name).not.toBe(uiNode?.name);
    expect(securityNode?.metadata?.validatorDomain).toBe("security");
    expect(uiNode?.metadata?.validatorDomain).toBe("ui-design");
    expect(securityNode?.metadata?.role).toBe("validator");
  });

  test("reports unknown, never a fabricated domain, for a validation recorded before the domain field existed", () => {
    const task = withRawValidations(makeTask("T-legacy", { status: "validating" }), [
      {
        validator_id: "val-legacy",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
      },
    ]);
    const dataset = generateGraphDataset({ runId: "run-legacy-domain", state: makeState([task]) });
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-legacy");

    expect(validator?.name).toBe("Validator (unknown): val-legacy");
    expect(validator?.metadata?.validatorDomain).toBe("unknown");
  });

  test("reports unknown, never a fabricated domain, for a domain string outside the five known slugs", () => {
    const task = withRawValidations(makeTask("T-bogus", { status: "validating" }), [
      {
        validator_id: "val-bogus",
        domain: "not-a-real-domain",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
      },
    ]);
    const dataset = generateGraphDataset({ runId: "run-bogus-domain", state: makeState([task]) });
    const validator = dataset.nodes.find((node) => node.id === "node-validator-T-bogus");

    expect(validator?.metadata?.validatorDomain).toBe("unknown");
  });

  test("an archived validation round carries its own recorded domain, distinct from the live round's", () => {
    const task = makeTask("T-multi-domain", {
      status: "done",
      repair_round: 1,
      report: { summary: "done", files_changed: ["src/T-multi-domain.ts"] },
      validation_history: [
        {
          validator_id: "val-r1",
          domain: "security",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
      validations: [
        {
          validator_id: "val-r2",
          domain: "ui-design",
          token_digest: "tok",
          attempt: 2,
          started_at: "2026-08-14T20:20:00.000Z",
          deadline_at: "2026-08-14T20:30:00.000Z",
          verdict: "pass",
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-archived-domain",
      state: makeState([task]),
    });

    const archived = dataset.nodes.find((node) => node.id === "node-validator-T-multi-domain-r1");
    const live = dataset.nodes.find((node) => node.id === "node-validator-T-multi-domain");

    expect(archived?.name).toBe("Validator (security): val-r1");
    expect(archived?.metadata?.validatorDomain).toBe("security");
    expect(live?.name).toBe("Validator (ui-design): val-r2");
    expect(live?.metadata?.validatorDomain).toBe("ui-design");
  });

  test("an archived round predating the domain field reports unknown rather than borrowing the live round's domain", () => {
    const rawHistory = [
      {
        validator_id: "val-legacy",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-14T20:00:00.000Z",
        deadline_at: "2026-08-14T20:10:00.000Z",
        verdict: "reject",
      },
    ];
    const task = {
      ...makeTask("T-archived-legacy", { status: "changes_requested", repair_round: 1 }),
      validation_history: rawHistory,
    } as unknown as TaskRecord;
    const dataset = generateGraphDataset({
      runId: "run-archived-legacy-domain",
      state: makeState([task]),
    });

    const archived = dataset.nodes.find(
      (node) => node.id === "node-validator-T-archived-legacy-r1",
    );
    expect(archived?.name).toBe("Validator (unknown): val-legacy");
    expect(archived?.metadata?.validatorDomain).toBe("unknown");
  });
});

describe("an in-lease repair round's ledger-granted role agrees with telemetry instead of contradicting it", () => {
  function repairingTask(): TaskRecord {
    return makeTask("T-repair", {
      status: "changes_requested",
      repair_round: 1,
      repair_assignee: "agent-1",
    });
  }

  test("metadata.role mirrors the implementer grant on the live repair-round node", () => {
    const dataset = generateGraphDataset({
      runId: "run-repair",
      state: makeState([repairingTask()], {
        agents: [makeGrant("agent-1", { role: "implementer" })],
      }),
    });
    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-repair");

    expect(node?.telemetry?.role).toBe("implementer");
    expect(node?.metadata?.role).toBe("implementer");
  });

  test("states no role at all when the agent has no ledger grant to read one from", () => {
    const dataset = generateGraphDataset({
      runId: "run-repair-no-grant",
      state: makeState([repairingTask()]),
    });
    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-repair");

    expect(node?.telemetry).toBeUndefined();
    expect(node?.metadata?.role).toBeUndefined();
    expect(node?.kind).toBe("agent");
  });

  test("an archived implementer round mirrors the ledger's currently recorded role for that agent", () => {
    const task = makeTask("T-archived-repair", {
      status: "changes_requested",
      repair_round: 1,
      original_implementer: "agent-1",
      validation_history: [
        {
          validator_id: "val-1",
          domain: "security",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
    });
    const dataset = generateGraphDataset({
      runId: "run-archived-repair",
      state: makeState([task], { agents: [makeGrant("agent-1", { role: "implementer" })] }),
    });
    const archivedImpl = dataset.nodes.find(
      (entry) => entry.id === "node-task-T-archived-repair-r1",
    );

    expect(archivedImpl?.telemetry?.role).toBe("implementer");
    expect(archivedImpl?.metadata?.role).toBe("implementer");
  });

  test("reassigned implementer multi-round role projection cleanly distinguishes the initial round from the repair round by agent, not by role name", () => {
    const task = makeTask("T-reassign", {
      status: "changes_requested",
      repair_round: 1,
      original_implementer: "agent-1",
      repair_assignee: "agent-2",
      validation_history: [
        {
          validator_id: "val-1",
          domain: "security",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
    });

    const dataset = generateGraphDataset({
      runId: "run-reassign",
      state: makeState([task], {
        agents: [
          makeGrant("agent-1", { role: "implementer" }),
          makeGrant("agent-2", { role: "implementer" }),
        ],
      }),
    });

    const archivedNode = dataset.nodes.find((n) => n.id === "node-task-T-reassign-r1");
    const liveNode = dataset.nodes.find((n) => n.id === "node-task-T-reassign");

    expect(archivedNode?.metadata?.role).toBe("implementer");
    expect(archivedNode?.telemetry?.role).toBe("implementer");
    expect(archivedNode?.telemetry?.agentId).toBe("agent-1");

    expect(liveNode?.metadata?.role).toBe("implementer");
    expect(liveNode?.telemetry?.role).toBe("implementer");
    expect(liveNode?.metadata?.agentId).toBe("agent-2");

    expect(archivedNode?.metadata?.role).toBe(liveNode?.metadata?.role);
    expect(archivedNode?.telemetry?.agentId).not.toBe(liveNode?.metadata?.agentId);
  });
});

describe("a branched sub-task's ledger-granted role reaches its node", () => {
  function branchWithSubTasks(): BranchRecord {
    return {
      id: "B-role",
      parent_task_id: "T-parent",
      parent_agent_id: "worker-1",
      reason: "split verification from implementation",
      depth: 1,
      status: "open",
      opened_at: "2026-08-14T20:05:00.000Z",
      sub_tasks: [
        {
          id: "B-role-impl",
          label: "Implement the fix",
          write_scope: ["src/foo.ts"],
          status: "claimed",
          agent_id: "sub-impl",
        },
        {
          id: "B-role-verify",
          label: "Verify the fix",
          write_scope: ["src/foo.ts"],
          status: "claimed",
          agent_id: "sub-verify",
        },
      ],
    };
  }

  test("sub-implementer and sub-validator sub-tasks are distinguished, not left roleless", () => {
    const dataset = generateGraphDataset({
      runId: "run-sub-roles",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWithSubTasks()],
        agents: [
          makeGrant("sub-impl", { role: "sub-implementer" }),
          makeGrant("sub-verify", { role: "sub-validator" }),
        ],
      }),
    });

    const impl = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-impl");
    const verify = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-verify");

    expect(impl?.metadata?.role).toBe("sub-implementer");
    expect(verify?.metadata?.role).toBe("sub-validator");
    expect(impl?.metadata?.role).not.toBe(verify?.metadata?.role);
  });

  test("a sub-task with no ledger grant gets no fabricated role", () => {
    const dataset = generateGraphDataset({
      runId: "run-sub-no-grant",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWithSubTasks()],
      }),
    });
    const impl = dataset.nodes.find((node) => node.id === "node-branch-B-role-B-role-impl");

    expect(impl?.metadata?.role).toBeUndefined();
    expect("role" in (impl?.metadata ?? {})).toBe(false);
  });

  test("confines sub-task roles to grants and prevents role leakage to ungranted sub-tasks", () => {
    const branchWith3SubTasks: BranchRecord = {
      id: "B-triple",
      parent_task_id: "T-parent",
      parent_agent_id: "worker-1",
      reason: "decomposition",
      depth: 1,
      status: "open",
      opened_at: "2026-08-14T20:05:00.000Z",
      sub_tasks: [
        {
          id: "B-triple-sub-1",
          label: "Subtask 1",
          write_scope: ["src/1.ts"],
          status: "claimed",
          agent_id: "agent-sub-1",
        },
        {
          id: "B-triple-sub-2",
          label: "Subtask 2",
          write_scope: ["src/2.ts"],
          status: "claimed",
          agent_id: "agent-sub-2",
        },
        {
          id: "B-triple-sub-3",
          label: "Subtask 3",
          write_scope: ["src/3.ts"],
          status: "claimed",
          agent_id: "agent-sub-3",
        },
      ],
    };

    const dataset = generateGraphDataset({
      runId: "run-sub-confinement",
      state: makeState([makeTask("T-parent", { status: "branched" })], {
        branches: [branchWith3SubTasks],
        agents: [
          makeGrant("agent-sub-1", { role: "sub-implementer" }),
          makeGrant("agent-sub-2", { role: "sub-validator" }),
        ],
      }),
    });

    const node1 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-1");
    const node2 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-2");
    const node3 = dataset.nodes.find((n) => n.id === "node-branch-B-triple-B-triple-sub-3");

    expect(node1?.metadata?.role).toBe("sub-implementer");
    expect(node2?.metadata?.role).toBe("sub-validator");
    expect(node3?.metadata?.role).toBeUndefined();
    expect(node3?.telemetry).toBeUndefined();
    expect("role" in (node3?.metadata ?? {})).toBe(false);
  });
});
