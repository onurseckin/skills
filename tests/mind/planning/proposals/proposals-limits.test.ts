import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { recordProposal } from "../../../../olt/scripts/src/mind/proposals/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("mind/proposal.ts - Proposal Rate Limits and Deduplication (in-memory virtual)", () => {
  const runRoot = `${process.cwd()}/.olt/virtual-prop-limits-run`;
  let inMemoryState: RunState;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    inMemoryState = {
      version: "2.0.0",
      run_id: "test-run",
      status: "active",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
      tasks: {},
      agents: [],
      candidates: [],
      requirements: [],
    };

    spies.push(spyOn(storeModule, "loadRun").mockImplementation(() => inMemoryState));
    spies.push(
      spyOn(storeModule, "transact").mockImplementation((...args: unknown[]) => {
        const mutator = args.find((a) => typeof a === "function") as
          | ((s: RunState) => unknown)
          | undefined;
        if (mutator) mutator(inMemoryState);
        return inMemoryState;
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("proposals exceeding ceiling are refused", () => {
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
        pulseId: "pulse-2",
        now: "2026-08-21T00:00:00.000Z",
      }),
    ).toThrow(HarnessError);
  });
});
