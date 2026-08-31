import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Feedback Queue Suite", () => {
  it("formats feedback proposal briefs cleanly", () => {
    const brief = formatProposalBrief({
      id: "prop-queue-1",
      statement: "Process feedback queue item",
      rationale: "Improve test suite",
      charter_goal_ids: ["goal-queue"],
      write_scope: ["src/queue.ts"],
      status: "needs_authority",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      fingerprint: "fp-queue-1",
      proposer_agent_id: "mind-queue",
      pulse_id: "pulse-queue-1",
    });
    expect(brief).toContain("Process feedback queue item");
  });
});
