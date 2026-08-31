import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Strategy Roles Suite", () => {
  it("formats role proposal briefs cleanly", () => {
    const brief = formatProposalBrief({
      id: "prop-role-1",
      statement: "Dynamic role registration",
      rationale: "Align with strategic priorities",
      charter_goal_ids: ["goal-roles"],
      write_scope: ["olt/roles/mind.yaml"],
      status: "needs_authority",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      fingerprint: "fp-role-1",
      proposer_agent_id: "mind-roles",
      pulse_id: "pulse-role-1",
    });
    expect(brief).toContain("Dynamic role registration");
  });
});
