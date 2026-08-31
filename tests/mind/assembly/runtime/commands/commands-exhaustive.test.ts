import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Assembly Sub-Suite", () => {
  it("formats assembly proposal briefs cleanly", () => {
    const brief = formatProposalBrief({
      id: "prop-asm-sub-1",
      statement: "Assembly system lifecycle bootstrap",
      rationale: "Initialize runtime orchestrator",
      charter_goal_ids: ["goal-asm"],
      write_scope: ["src/mind.ts"],
      status: "needs_authority",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      fingerprint: "fp-asm-sub-1",
      proposer_agent_id: "mind-assembly",
      pulse_id: "pulse-asm-sub-1",
    });
    expect(brief).toContain("Assembly system lifecycle");
  });
});
