import { describe, expect, it } from "bun:test";
import { formatProposalBrief } from "../../../../olt/scripts/src/mind/proposals/index.ts";

describe("Mind Heuristics Soak & Injections Suite", () => {
  it("formats proposal briefs under soak workload", () => {
    for (let i = 0; i < 5; i++) {
      const brief = formatProposalBrief({
        id: `prop-soak-${i}`,
        statement: "Soak testing feature",
        rationale: "Verify resilience",
        charter_goal_ids: ["goal-soak"],
        write_scope: ["src/soak.ts"],
        status: "needs_authority",
        created_at: "2026-08-25T00:00:00.000Z",
        updated_at: "2026-08-25T00:00:00.000Z",
        fingerprint: `fp-soak-${i}`,
        proposer_agent_id: "mind-soak",
        pulse_id: `pulse-soak-${i}`,
      });
      expect(brief).toContain("Soak testing feature");
    }
  });
});
