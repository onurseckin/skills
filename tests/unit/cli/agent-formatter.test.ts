import { describe, expect, test } from "bun:test";
import type { AgentGrantRecord } from "../../../olt/scripts/src/contracts/agents.ts";
import type { TaskLineage } from "../../../olt/scripts/src/workflow/agents/lineage.ts";
import {
  formatAgentLineageBrief,
  formatAgentListBrief,
  formatAgentRegisterBrief,
  formatAgentReleaseBrief,
  formatAgentReportBrief,
} from "../../../olt/scripts/src/cli/formatters/agent-formatter.ts";
import { formatDeterministicActionChaining } from "../../../olt/scripts/src/cli/formatters/next-actions.ts";

function grant(overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id: "agent-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "local",
    granted_at: "2026-08-19T10:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("formatAgentRegisterBrief", () => {
  test("labels every evidenced field or admits it is unknown", () => {
    const brief = formatAgentRegisterBrief(
      grant({
        provider: { value: "anthropic", evidence_class: "agent_reported" },
        model: { value: "claude", evidence_class: "agent_reported", is_estimated: true },
        tools_granted: {
          value: [{ name: "bash", category: "shell" }, { name: "mystery" }],
          evidence_class: "agent_reported",
        },
      }),
      "run-1",
    );

    expect(brief).toContain("### Agent Granted: agent-1 (implementer)");
    expect(brief).toContain("root / no task");
    expect(brief).toContain("`anthropic` (agent_reported)");
    expect(brief).toContain("`claude` (agent_reported, estimated)");
    expect(brief).toContain("`bash` (shell)");
    expect(brief).toContain("`mystery` (uncategorised)");
    expect(brief).toContain("agent:release --run run-1 --agent agent-1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts queue:next --run run-1` [Agent] — Check queue for claimable tasks",
    );
    expect(brief).toContain(
      '`bun harness.ts agent:release --run run-1 --agent agent-1 --reason "<WHY>"` [Coordinator] — Release agent grant upon completion',
    );
    // Fields never evidenced are said to be unknown, never guessed.
    expect(brief).toContain("**Thinking**: unknown");
  });

  test("names the parent agent and task, and flags an unrecognised tool category", () => {
    const brief = formatAgentRegisterBrief(
      grant({
        parent_agent_id: "agent-0",
        parent_task_id: "task-1",
        tools_granted: {
          value: [{ name: "odd-tool", category: "not-a-real-category" }],
          evidence_class: "harness_observed",
        },
      }),
      "run-1",
    );

    expect(brief).toContain("`agent-0` / task `task-1`");
    expect(brief).toContain("unrecognised category");
  });

  test("an empty tool grant reports none, not an empty table cell", () => {
    const brief = formatAgentRegisterBrief(
      grant({ tools_granted: { value: [], evidence_class: "agent_reported" } }),
      "run-1",
    );
    expect(brief).toContain("none (agent_reported)");
  });
});

describe("formatAgentReportBrief", () => {
  test("summarises tool usage, token counters, and other reported counters", () => {
    const brief = formatAgentReportBrief(
      grant({
        report_count: 3,
        last_reported_at: "2026-08-19T11:00:00.000Z",
        tools_used: [{ name: "bash", category: "shell", evidence_class: "agent_reported" }],
        tokens_in: { value: 100, evidence_class: "agent_reported" },
        tokens_out: { value: 50, evidence_class: "agent_reported" },
        token_extras: { cache_read: { value: 10, evidence_class: "agent_reported" } },
      }),
      "run-1",
    );

    expect(brief).toContain("### Agent Report: agent-1 (implementer)");
    expect(brief).toContain("Reports Ingested**: 3 (latest 2026-08-19T11:00:00.000Z)");
    expect(brief).toContain("`bash` (shell) [agent_reported]");
    expect(brief).toContain("`cache_read` `10` (agent_reported)");
    expect(brief).toContain("**Run**: `run-1`");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts agent:list --run run-1` [Coordinator] — Inspect all active agent grants",
    );
  });

  test("a grant with nothing reported yet says so plainly, with no reports and no counters", () => {
    const brief = formatAgentReportBrief(grant(), "run-1");
    expect(brief).toContain("Reports Ingested**: 0 (latest unknown)");
    expect(brief).toContain("none reported");
  });
});

describe("formatAgentReleaseBrief", () => {
  test("records when and why a grant ended", () => {
    const brief = formatAgentReleaseBrief(
      grant({
        status: "released",
        released_at: "2026-08-19T12:00:00.000Z",
        release_reason: "task complete",
        tokens_in: { value: 5, evidence_class: "agent_reported" },
      }),
      "run-1",
    );

    expect(brief).toContain("### Agent Released: agent-1 (implementer)");
    expect(brief).toContain("**Released At**: 2026-08-19T12:00:00.000Z");
    expect(brief).toContain("**Reason**: task complete");
    expect(brief).toContain("agent:list --run run-1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts agent:register --run run-1 --agent <AGENT_ID> --role <ROLE> --host <HOST>` [Coordinator] — Register new agent grant",
    );
    expect(brief).toContain(
      "`bun harness.ts run:status --run run-1` [Orchestrator] — Inspect active lanes and lease status",
    );
  });

  test("an unreleased grant admits it has no release time or reason", () => {
    const brief = formatAgentReleaseBrief(grant(), "run-1");
    expect(brief).toContain("**Released At**: unknown");
    expect(brief).toContain("**Reason**: none recorded");
  });
});

describe("formatAgentListBrief", () => {
  test("with no grants at all, states zero active and zero released", () => {
    const brief = formatAgentListBrief([], "run-1", false);
    expect(brief).toContain("**Active Grants**: 0");
    expect(brief).toContain("**Released Grants**: 0");
    expect(brief).toContain("agent:register --run run-1");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts agent:register --run run-1 --agent <AGENT_ID> --role <ROLE> --host <HOST>` [Coordinator] — Register new agent grant",
    );
  });

  test("hides released grants unless the caller opts in", () => {
    const grants = [grant({ id: "a1", status: "active" }), grant({ id: "a2", status: "released" })];

    const activeOnly = formatAgentListBrief(grants, "run-1", false);
    expect(activeOnly).not.toContain("a2");

    const withReleased = formatAgentListBrief(grants, "run-1", true);
    expect(withReleased).toContain("`a2`");
    expect(withReleased).toContain("**Active**: 1 · **Released**: 1");
  });

  test("when every grant is released and hidden, falls back to the empty-grants message", () => {
    const brief = formatAgentListBrief([grant({ status: "released" })], "run-1", false);
    expect(brief).toContain("**Active Grants**: 0");
    expect(brief).toContain("**Released Grants**: 1");
  });

  test("renders a row per grant with its parentage and status", () => {
    const brief = formatAgentListBrief(
      [
        grant({ id: "root-agent" }),
        grant({ id: "child-agent", parent_agent_id: "root-agent", parent_task_id: "task-1" }),
      ],
      "run-1",
      false,
    );

    expect(brief).toContain("| `root-agent`");
    expect(brief).toContain("root");
    expect(brief).toContain("| `child-agent`");
    expect(brief).toContain("`root-agent`");
    expect(brief).toContain("`task-1`");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts agent:register --run run-1 --agent <AGENT_ID> --role <ROLE> --host <HOST>` [Coordinator] — Register new agent grant",
    );
    expect(brief).toContain(
      "`bun harness.ts run:status --run run-1` [Orchestrator] — Inspect active lanes and lease status",
    );
  });
});

describe("formatAgentLineageBrief", () => {
  function lineage(overrides: Partial<TaskLineage> = {}): TaskLineage {
    return { task_id: "task-1", agents: [], ...overrides };
  }

  test("a task with no agents registered says so plainly", () => {
    const brief = formatAgentLineageBrief(lineage());
    expect(brief).toContain("### Task Lineage: task-1");
    expect(brief).toContain("none registered against this task");
  });

  test("renders each agent's depth and ancestry, root agents included", () => {
    const brief = formatAgentLineageBrief(
      lineage({
        agents: [
          {
            agent_id: "root-agent",
            role: "implementer",
            parent_agent_id: null,
            parent_task_id: "task-1",
            status: "active",
            depth: 0,
            ancestors: [],
          },
          {
            agent_id: "child-agent",
            role: "implementer",
            parent_agent_id: "root-agent",
            parent_task_id: null,
            status: "active",
            depth: 1,
            ancestors: ["root-agent"],
          },
        ],
      }),
    );

    expect(brief).toContain("| 0 | `root-agent` | implementer | root | active |");
    expect(brief).toContain("`root-agent`");
    expect(brief).toContain("`child-agent`");
    expect(brief).toContain("⚡ Next Actions:");
    expect(brief).toContain(
      "`bun harness.ts task:claim --task task-1 --agent <AGENT>` [Implementer] — Inspect or claim task",
    );
  });
});

describe("formatDeterministicActionChaining", () => {
  test("generates deterministic action chains for agent and critic stages", () => {
    const agentActions = formatDeterministicActionChaining("agent", {
      runId: "run-xyz",
      role: "Worker",
    });
    expect(agentActions.length).toBeGreaterThan(0);
    expect(agentActions.join("\n")).toContain("⚡ Next Actions:");
    expect(agentActions.join("\n")).toContain("bun harness.ts agent:register --run run-xyz");
    expect(agentActions.join("\n")).toContain("[Coordinator] — Register new agent grant");
    expect(agentActions.join("\n")).toContain("bun harness.ts queue:next --run run-xyz` [Worker]");

    const criticActions = formatDeterministicActionChaining("critic", { runId: "run-xyz" });
    expect(criticActions.join("\n")).toContain(
      "bun harness.ts critic:start --run run-xyz --critic critic-1` [Critic]",
    );
    expect(criticActions.join("\n")).toContain(
      "bun harness.ts run:complete --run run-xyz --auth-token <TOKEN>` [Orchestrator]",
    );
  });
});
