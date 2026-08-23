import { describe, expect, test } from "bun:test";
import type { TelemetryFieldConflict } from "../../../olt/scripts/src/core/contracts/agents.ts";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph-generator.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { makeGrant, makeState, makeTask } from "./graph-fixtures.ts";
import { cleanupRoots, emptyState, render } from "./markdown-fixtures.ts";

const CONFLICT: TelemetryFieldConflict = {
  field: "model",
  recorded_value: "explicit-model",
  recorded_evidence_class: "agent_reported",
  probed_value: "derived-model",
  probed_evidence_class: "derived",
};

function leasedTask(agentId: string): TaskRecord {
  return makeTask("T-1", {
    status: "done",
    report: { summary: "done", files_changed: ["src/T-1.ts"] },
    lease: {
      agent_id: agentId,
      role: "implementer",
      attempt: 1,
      token_digest: "tok",
      issued_at: "2026-08-14T20:00:00.000Z",
      expires_at: "2026-08-14T21:00:00.000Z",
      heartbeat_at: "2026-08-14T20:00:00.000Z",
      duration_seconds: 3600,
      write_scope: ["src/T-1.ts"],
      resource_scope: [],
    },
  });
}

/**
 * B39: a telemetry conflict must reach both `graph.json` and `summary.md`, naming the two sources,
 * the two values and both evidence classes — never resolved by picking a winner and hiding the
 * other. Before this fix, `TelemetryFieldConflict`s were computed at `agent:register` and every
 * task-boundary probe but discarded once the transaction returned; grepping `summary/` and
 * `reporting/` for them found nothing (B39 finding 1's own re-audit). These tests read the two
 * actual deliverables a human or gvui opens, not the merge functions that produce the data.
 */
describe("graph.json surfaces telemetry_conflicts", () => {
  test("run.agents[] carries a grant's conflicts with both values and both evidence classes", () => {
    const grants = [makeGrant("worker-1", { telemetry_conflicts: [CONFLICT] })];
    const dataset = generateGraphDataset({
      runId: "run-conflict",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    });

    const agent = dataset.run?.agents?.find((entry) => entry.id === "worker-1");
    expect(agent?.telemetry_conflicts).toEqual([CONFLICT]);
  });

  test("the task node's own telemetry also carries the conflict, not only the run-level ledger", () => {
    const grants = [makeGrant("worker-1", { telemetry_conflicts: [CONFLICT] })];
    const dataset = generateGraphDataset({
      runId: "run-conflict-node",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    });

    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-1");
    expect(node?.telemetry?.telemetryConflicts).toEqual([CONFLICT]);
  });

  test("a grant with no disagreement carries no telemetryConflicts field, on the node or the ledger", () => {
    const grants = [
      makeGrant("worker-1", { model: { value: "m", evidence_class: "agent_reported" } }),
    ];
    const dataset = generateGraphDataset({
      runId: "run-no-conflict",
      state: makeState([leasedTask("worker-1")], { agents: grants }),
    });

    const node = dataset.nodes.find((entry) => entry.id === "node-task-T-1");
    expect(node?.telemetry?.telemetryConflicts).toBeUndefined();
    expect(dataset.run?.agents?.[0]?.telemetry_conflicts).toBeUndefined();
    expect(JSON.stringify(dataset)).not.toContain("telemetryConflicts");
    expect(JSON.stringify(dataset)).not.toContain("telemetry_conflicts");
  });
});

describe("summary.md renders a Telemetry conflicts table in section 17", () => {
  test("names the agent, the field, both values and both evidence classes", () => {
    const state = {
      ...emptyState,
      agents: [
        {
          id: "worker-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
          telemetry_conflicts: [CONFLICT],
        },
      ],
    };
    const markdown = render(state);
    cleanupRoots();

    const section = markdown.slice(markdown.indexOf("## 17. Model And Token Telemetry"));
    expect(section).toContain("### Telemetry conflicts");
    expect(section).toContain("`worker-1`");
    expect(section).toContain("`model`");
    expect(section).toContain("explicit-model");
    expect(section).toContain("agent_reported");
    expect(section).toContain("derived-model");
    expect(section).toContain("derived");
    // The note beside the per-agent table must no longer claim every value in it is host-reported —
    // most of what the table shows is a CLI flag's own claim, not a host attestation (B39 finding 1).
    expect(section).not.toContain("only ever what a host reported through the CLI");
  });

  test("renders a numeric or boolean conflict value as plain text, not JSON", () => {
    const numericConflict: TelemetryFieldConflict = {
      field: "context_window",
      recorded_value: 200000,
      recorded_evidence_class: "agent_reported",
      probed_value: true,
      probed_evidence_class: "derived",
    };
    const state = {
      ...emptyState,
      agents: [
        {
          id: "worker-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
          telemetry_conflicts: [numericConflict],
        },
      ],
    };
    const markdown = render(state);
    cleanupRoots();

    const section = markdown.slice(markdown.indexOf("## 17. Model And Token Telemetry"));
    expect(section).toContain(
      "| `worker-1` | `context_window` | 200000 | agent_reported | true | derived |",
    );
  });

  test("renders the explicit no-conflict note when no probe ever disagreed", () => {
    const markdown = render(emptyState);
    cleanupRoots();

    const section = markdown.slice(markdown.indexOf("## 17. Model And Token Telemetry"));
    expect(section).toContain("### Telemetry conflicts");
    expect(section).toContain("No probe ever disagreed with an explicitly reported value.");
  });
});
