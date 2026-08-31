import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Strategy Governance Sub-Suite", () => {
  it("formats governance proposal briefs cleanly", () => {
    const brief = formatProposalBrief({
      id: "prop-gov-sub-1",
      statement: "Governance policy update",
      rationale: "Align with strategic priorities",
      charter_goal_ids: ["goal-gov"],
      write_scope: ["docs/charter.md"],
      status: "needs_authority",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      fingerprint: "fp-gov-sub-1",
      proposer_agent_id: "mind-governance",
      pulse_id: "pulse-gov-sub-1",
    });
    expect(brief).toContain("Governance policy update");
  });
});
