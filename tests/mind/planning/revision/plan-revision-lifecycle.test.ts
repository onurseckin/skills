import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Hierarchy & Planning Integration Suite", () => {
  it("formats proposal briefs accurately", () => {
    const brief = formatProposalBrief({
      id: "prop-1",
      statement: "Statement",
      rationale: "Rationale",
      charter_goal_ids: ["G1"],
      write_scope: [],
      status: "needs_authority",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
      fingerprint: "fp",
      proposer_agent_id: "mind-1",
      pulse_id: "pulse-1",
    });
    expect(brief).toContain("Statement");
  });
});
