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

describe("mind/proposal.ts - Proposal Rate Limits and Deduplication", () => {
  it("proposals exceeding ceiling are refused", () => {
    const runRoot = setupCapsule();

    for (let i = 0; i < 5; i++) {
      recordProposal(runRoot, {
        statement: `Proposal ${i}`,
        rationale: "Reason",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: `pulse-${i}`,
        now: new Date(Date.parse("2026-08-21T00:00:00.000Z") + i * 86400000).toISOString(),
      });
    }

    expect(() =>
      recordProposal(runRoot, {
        statement: "Exceeding proposal",
        rationale: "Reason",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
        maxOpenProposals: 5,
      }),
    ).toThrow(HarnessError);
  });

  it("duplicate open proposals are refused", () => {
    const runRoot = setupCapsule();

    recordProposal(runRoot, {
      statement: "Unique proposal",
      rationale: "Reason",
      charter_goal_ids: ["G1"],
      write_scope: ["src/a.ts"],
      actor: "mind-1",
      pulseId: "pulse-1",
      now: "2026-08-21T00:00:00.000Z",
    });

    expect(() =>
      recordProposal(runRoot, {
        statement: "Unique proposal",
        rationale: "Reason",
        charter_goal_ids: ["G1"],
        write_scope: ["src/a.ts"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
      }),
    ).toThrow(HarnessError);
  });
});
