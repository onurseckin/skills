import { describe, expect, it } from "bun:test";
import {
  checkProposalRateLimits,
  formatProposalBrief,
  getProposal,
  recordProposal,
  transitionProposalStatus,
  PROPOSAL_LIFECYCLE_STATUSES,
} from "../../../../olt/scripts/src/mind/proposals/index.ts";
import type { ProposalRecord, ProposalLifecycleStatus } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupCapsule(): string {
  const repo = mkdtempSync(join(tmpdir(), "prop-test-"));
  mkdirSync(join(repo, "olt", "agents"), { recursive: true });
  writeFileSync(join(repo, "olt", "agents", "mind.yaml"), "role: mind\n");
  const run = initRun(repo, "test-run", Buffer.from("role: mind\n"), "file", true);
  return run;
}

describe("mind/proposal.ts - Proposal Lifecycle and Creation", () => {
  it("proposals without witnesses accepted: creates needs_authority proposal and requirement", () => {
    const runRoot = setupCapsule();
    const record = recordProposal(runRoot, {
      statement: "Implement feature X",
      rationale: "Improves modularity",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      now: "2026-08-21T00:00:00.000Z",
    });
    expect(record.status).toBe("needs_authority");
    expect(record.statement).toBe("Implement feature X");
  });

  it("proposals with witnesses are refused upon creation", () => {
    const runRoot = setupCapsule();
    expect(() =>
      recordProposal(runRoot, {
        statement: "Implement feature X",
        rationale: "Improves modularity",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
        witness: { witness_type: "owner-decision", approved_by: "owner", rationale: "Approved" },
      }),
    ).toThrow(HarnessError);
  });

  it("proposal input validation: rejects blank statement, rationale, or missing goals", () => {
    const runRoot = setupCapsule();
    expect(() =>
      recordProposal(runRoot, {
        statement: "",
        rationale: "Rationale",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
      }),
    ).toThrow(HarnessError);
  });
});
