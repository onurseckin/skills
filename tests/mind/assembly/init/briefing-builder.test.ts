import { describe, expect, it } from "bun:test";
import {
  formatProposalBrief,
  formatPlanRevisionBrief,
} from "../../../../olt/scripts/src/mind/proposals/index.ts";
import { buildExactAnchorBriefing } from "../../../../olt/scripts/src/mind/proposals/builder/briefing.ts";
import type {
  MindProposal,
  PlanRevisionProposal,
} from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Assembly Init Briefing Builder Suite", () => {
  const baseProposal: MindProposal = {
    id: "prop-asm-1",
    statement: "Assembly system lifecycle bootstrap",
    rationale: "Initialize runtime orchestrator",
    charter_goal_ids: ["goal-asm-1", "goal-asm-2"],
    write_scope: ["src/mind.ts"],
    status: "needs_authority",
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    fingerprint: "fp-asm-1",
    proposer_agent_id: "mind-assembly",
    pulse_id: "pulse-asm-1",
    requirement_id: "req-init-1",
  };

  it("formats minimal proposal brief with mandatory fields and default witness", () => {
    const brief = formatProposalBrief(baseProposal);
    expect(brief).toContain("### Proposal: `prop-asm-1`");
    expect(brief).toContain("- **Status**: NEEDS_AUTHORITY");
    expect(brief).toContain('- **Statement**: "Assembly system lifecycle bootstrap"');
    expect(brief).toContain("- **Rationale**: Initialize runtime orchestrator");
    expect(brief).toContain("- **Charter Goals**: goal-asm-1, goal-asm-2");
    expect(brief).toContain("- **Requirement ID**: `req-init-1`");
    expect(brief).toContain("- **Witness**: none (awaiting owner authority)");
    expect(brief).not.toContain("Decided By");
    expect(brief).not.toContain("Decline Reason");
  });

  it("formats proposal brief with decision audit trail (decided_by, decided_at)", () => {
    const decided: MindProposal = {
      ...baseProposal,
      status: "admitted",
      witness: "witness-sig-123",
      decided_by: "lead-architect",
      decided_at: "2026-08-25T01:00:00.000Z",
    };
    const brief = formatProposalBrief(decided);
    expect(brief).toContain("- **Status**: ADMITTED");
    expect(brief).toContain("- **Witness**: witness-sig-123");
    expect(brief).toContain("- **Decided By**: `lead-architect` at 2026-08-25T01:00:00.000Z");
  });

  it("formats proposal brief with decline reason and autonomous initiative trigger/score", () => {
    const declined: MindProposal = {
      ...baseProposal,
      status: "declined",
      decline_reason: "Duplicate candidate in active ledger",
      autonomous_initiative: true,
      initiative_trigger_id: "trig-auto-99",
      initiative_score: 0.94,
    };
    const brief = formatProposalBrief(declined);
    expect(brief).toContain("- **Status**: DECLINED");
    expect(brief).toContain("- **Decline Reason**: Duplicate candidate in active ledger");
    expect(brief).toContain("- **Autonomous Initiative**: Trigger `trig-auto-99` (Score: 0.94)");
  });

  it("formats plan revision brief with generated subtasks and confidence percentage", () => {
    const revision: PlanRevisionProposal = {
      id: "rev-asm-1",
      revisionType: "TASK_SPLIT",
      signal: {
        signalType: "TEST_REGRESSION",
        severity: "CRITICAL",
        affectedWriteScopes: ["src/mind.ts"],
        detectedAt: "2026-08-25T00:00:00.000Z",
        context: "Failing unit test in pipeline",
      },
      confidenceScore: 0.925,
      autonomousAdvancementEligible: true,
      proposedChanges: {
        summary: "Decompose module to isolate failure domain",
        targetProposalId: "prop-asm-1",
        newTasks: [
          {
            id: "subtask-1",
            label: "Fix core test failure",
            writeScope: ["src/core.ts"],
            priority: "CRITICAL",
          },
          {
            id: "subtask-2",
            label: "Update mock harnesses",
            writeScope: ["tests/mock.ts"],
          },
        ],
      },
    };
    const brief = formatPlanRevisionBrief(revision);
    expect(brief).toContain("### Plan Revision: `rev-asm-1`");
    expect(brief).toContain("- **Type**: `TASK_SPLIT`");
    expect(brief).toContain("- **Signal**: `TEST_REGRESSION` (Severity: CRITICAL)");
    expect(brief).toContain("- **Confidence**: 92.5%");
    expect(brief).toContain("- **Autonomous Eligible**: YES");
    expect(brief).toContain("- **Summary**: Decompose module to isolate failure domain");
    expect(brief).toContain("#### Generated Tasks:");
    expect(brief).toContain("- **subtask-1**: Fix core test failure (CRITICAL)");
    expect(brief).toContain("- **subtask-2**: Update mock harnesses (MEDIUM)");
  });

  it("formats plan revision brief without subtasks and autonomous ineligibility", () => {
    const revision: PlanRevisionProposal = {
      id: "rev-asm-2",
      revisionType: "COORDINATOR_REORGANIZATION",
      signal: {
        signalType: "COGNITIVE_OVERLOAD",
        severity: "HIGH",
        affectedWriteScopes: ["src/mind.ts"],
        detectedAt: "2026-08-25T00:00:00.000Z",
      },
      confidenceScore: 0.65,
      autonomousAdvancementEligible: false,
      proposedChanges: {
        summary: "Rebalance coordinator concurrency pool",
      },
    };
    const brief = formatPlanRevisionBrief(revision);
    expect(brief).toContain("- **Type**: `COORDINATOR_REORGANIZATION`");
    expect(brief).toContain("- **Confidence**: 65.0%");
    expect(brief).toContain("- **Autonomous Eligible**: NO");
    expect(brief).not.toContain("#### Generated Tasks:");
  });

  it("buildExactAnchorBriefing builds briefing cleanly for target files", () => {
    const briefing = buildExactAnchorBriefing({
      taskId: "task-asm-1",
      label: "Assembly bootstrap task",
      targetFiles: [],
      writeScope: ["src/mind.ts"],
    });
    expect(briefing.taskId).toBe("task-asm-1");
    expect(briefing.anchors).toHaveLength(0);
    expect(briefing.symbols).toHaveLength(0);
    expect(briefing.markdown).toContain("Assembly bootstrap task");
    expect(briefing.waitMsMandate).toBe(10000);
    expect(briefing.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});
