import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Feedback Memory Sub-Suite", () => {
  it("formats memory proposal briefs cleanly", () => {
    const brief = formatProposalBrief({
      id: "prop-mem-1",
      statement: "Memory compaction and state sync",
      rationale: "Reduce memory footprint",
      charter_goal_ids: ["goal-mem"],
      write_scope: ["src/memory.ts"],
      status: "needs_authority",
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      fingerprint: "fp-mem-1",
      proposer_agent_id: "mind-memory",
      pulse_id: "pulse-mem-1",
    });
    expect(brief).toContain("Memory compaction");
  });
});
