import { describe, expect, test } from "bun:test";
import {
  formatAgentBrief,
  formatAgentLineageBrief,
  formatAgentListBrief,
  formatAgentRegisterBrief,
  formatAgentReleaseBrief,
  formatAgentReportBrief,
  formatBranchAbandonBrief,
  formatBranchClaimBrief,
  formatBranchCollectBrief,
  formatBranchOpenBrief,
  formatBranchStatusBrief,
  formatBranchSubmitBrief,
  formatEvidenceBrief,
  formatEvidenceListBrief,
  formatFindingBrief,
  formatFindingsListBrief,
  formatOrchestrateBrief,
  formatReportBrief,
  formatReportsListBrief,
  formatScreenshotsListBrief,
} from "../../../olt/scripts/src/cli/formatters/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { BranchRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskLineage } from "../../../olt/scripts/src/workflow/agents/lineage.ts";

export const formattersTerminalSuiteName = "core CLI formatters: agent, branch, finding, report, evidence & orchestration briefs";

describe(formattersTerminalSuiteName, () => {
  test("agent, branch, inspection, and screenshot formatters", () => {
    const brief = formatAgentBrief({
      agentId: "agent-1",
      role: "implementer",
      parentAgentId: "coord-1",
      parentTaskId: "t1",
      model: "gemini-2.0",
      thinkingLevel: "high",
      tools: ["bun test"],
      writeScope: ["src/index.ts"],
      recommendedCommands: ["bun test tests/contracts/runtime/formatters-markdown.test.ts"],
    });
    expect(brief).toContain("agent-1");

    const grant: AgentGrantRecord = {
      id: "agent-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: "t1",
      host: "darwin",
      granted_at: "2026-08-24T00:00:00.000Z",
      status: "active",
      provider: evidenced("google", "harness_observed"),
      model: evidenced("gemini-2.0", "harness_observed"),
      model_tier: evidenced("l", "harness_observed"),
      thinking_level: evidenced("high", "harness_observed"),
      context_window: evidenced(1000000, "harness_observed"),
      tools_granted: evidenced([{ name: "bun test" }], "harness_observed"),
      tokens_in: evidenced(100, "agent_reported"),
      tokens_out: evidenced(200, "agent_reported"),
    };

    expect(formatAgentRegisterBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentReportBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentReleaseBrief(grant, "run-001")).toContain("agent-1");
    expect(formatAgentListBrief([grant], "run-001")).toContain("agent-1");

    const lineage: TaskLineage = {
      task_id: "t1",
      agents: [
        {
          agent_id: "agent-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: "t1",
          status: "active",
          depth: 0,
          ancestors: [],
        },
      ],
    };
    expect(formatAgentLineageBrief(lineage)).toContain("agent-1");

    const branch: BranchRecord = {
      id: "b-1",
      parent_task_id: "t1",
      parent_agent_id: "agent-1",
      reason: "parallel decomposition",
      depth: 1,
      status: "open",
      opened_at: "2026-08-24T00:00:00.000Z",
      opened_observation: {
        observed_at: "2026-08-24T00:00:00.000Z",
        git_available: true,
        head: "sha1",
        entries: [],
      },
      sub_tasks: [
        {
          id: "st-1",
          label: "Subtask 1",
          write_scope: ["src/sub.ts"],
          status: "open",
        },
      ],
    };

    expect(formatBranchOpenBrief(branch, "run-001")).toContain("b-1");
    expect(formatBranchClaimBrief(branch, branch.sub_tasks[0]!, "tok-1", "run-001")).toContain(
      "b-1",
    );
    expect(formatBranchSubmitBrief(branch, "st-1")).toContain("b-1");
    expect(formatBranchCollectBrief(branch, "completed")).toContain("b-1");
    expect(formatBranchAbandonBrief(branch, "abandoned")).toContain("b-1");
    expect(formatBranchStatusBrief([branch], "run-001")).toContain("b-1");

    expect(
      formatFindingBrief({
        finding: { id: "f-1", severity: "critical", observation: "Crash bug" },
        path: "findings/f-1.json",
      }),
    ).toContain("f-1");

    expect(
      formatFindingsListBrief({
        findings: [{ id: "f-1", severity: "critical", observation: "Crash" }],
        count: 1,
      }),
    ).toContain("f-1");

    expect(
      formatReportBrief({
        report: { status: "passed", summary: "All checks passed" },
        path: "reports/rep-1.json",
        name: "Validation Report",
      }),
    ).toContain("Validation Report");

    expect(
      formatReportsListBrief({
        reports: [{ name: "Validation Report", path: "reports/rep-1.json" }],
        count: 1,
      }),
    ).toContain("Validation Report");

    expect(
      formatEvidenceBrief({
        evidence: { command_id: "ev-1", exit_code: 0, argv: ["bun", "test"] },
        path: "evidence/ev-1.json",
      }),
    ).toContain("ev-1");

    expect(
      formatEvidenceListBrief({
        evidence: [{ command_id: "ev-1", exit_code: 0, argv: ["bun", "test"] }],
        count: 1,
      }),
    ).toContain("ev-1");

    expect(
      formatScreenshotsListBrief({
        screenshots: [{ name: "shot-1", path: "/tmp/shot.png", task_id: "t1" }],
        count: 1,
        taskId: "t1",
      }),
    ).toContain("shot.png");

    expect(
      formatOrchestrateBrief({
        runId: "run-001",
        runRoot: "/tmp/capsules/run-001",
        promptSha256: "abc123sha",
        promptBytes: 500,
        runIdWasDerived: true,
      }),
    ).toContain("run-001");
  });
});
