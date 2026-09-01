import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { recordProposal } from "../../../../olt/scripts/src/mind/proposals/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("mind/proposal.ts - Proposal Lifecycle and Creation (in-memory virtual)", () => {
  const runRoot = `${process.cwd()}/.olt/virtual-prop-lifecycle-run`;
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

  it("proposals without witnesses accepted: creates needs_authority proposal and requirement", () => {
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

    expect(() =>
      recordProposal(runRoot, {
        statement: "Statement",
        rationale: "",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      recordProposal(runRoot, {
        statement: "Statement",
        rationale: "Rationale",
        charter_goal_ids: [],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: "2026-08-21T00:00:00.000Z",
      }),
    ).toThrow(HarnessError);
  });
});
