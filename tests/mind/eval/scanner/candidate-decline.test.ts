import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import { mindCandidateCommand } from "../../../../olt/scripts/src/cli/commands/mind-candidate.ts";
import { mindDeclineCommand } from "../../../../olt/scripts/src/cli/commands/mind-admit.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";

const MAX_OPEN_PROPOSALS = 3;
const mockRuns = new Map<string, RunState>();

function setupReachabilityTest(name: string): { readonly repo: string; readonly run: string } {
  const repo = `${process.cwd()}/.olt/virtual-reach-${name}`;
  const run = `${repo}/.olt/capsules/mind-decline-reach-${name}`;
  const charterSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const state: RunState = {
    version: "2.0.0",
    run_id: `mind-decline-reach-${name}`,
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    status: "succeeded",
    tasks: {},
    agents: [
      {
        id: "mind-1",
        role: "mind",
        host: "antigravity",
        status: "active",
        granted_at: "2026-08-21T00:00:00.000Z",
        parent_agent_id: null,
        parent_task_id: null,
      },
    ],
    mind: {
      generation: 1,
      opened_at: "2026-08-21T00:00:00.000Z",
      actor: "mind-1",
      charter: {
        source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals: ["G1"],
        non_goals: ["Out of scope"],
        repo_roots: ["src/"],
        evidence_class: "harness_observed",
      },
    },
    budget: {
      pulses_per_day: 96,
      wall_clock_ms_per_day: 21600000,
      max_agents_in_flight: 8,
      max_rounds_per_objective: 3,
      base_interval_ms: 900000,
      max_interval_ms: 14400000,
      max_pause_interval_ms: 1800000,
      pulse_deadline_ms: 1200000,
      max_open_proposals: MAX_OPEN_PROPOSALS,
      quiet_hours: null,
      day_key: "2026-08-21",
      pulses_today: 1,
      wall_clock_ms_today: 60000,
    },
    candidates: [],
  };
  mockRuns.set(run, state);
  return { repo, run };
}

beforeEach(() => {
  mockRuns.clear();
  spyOn(storeModule, "loadRun").mockImplementation((runPath: string) => {
    const state = mockRuns.get(runPath) ?? {
      version: "2.0.0",
      run_id: "test",
      created_at: "2026-08-21T00:00:00.000Z",
      updated_at: "2026-08-21T00:00:00.000Z",
      status: "succeeded",
      tasks: {},
      agents: [],
    };
    return {
      runRoot: runPath,
      manifest: {
        version: "2.0.0",
        run_id: "test",
        created_at: "2026-08-21T00:00:00.000Z",
        entry_task_id: "task-1",
      },
      state,
      events: [],
      prompt: new Uint8Array(),
      mode: "file",
      sourceVerified: true,
    };
  });

  spyOn(storeModule, "transact").mockImplementation((runPath, _actor, _kind, _payload, mutator) => {
    let state = mockRuns.get(runPath);
    if (!state) {
      state = {
        version: "2.0.0",
        run_id: "test",
        created_at: "2026-08-21T00:00:00.000Z",
        updated_at: "2026-08-21T00:00:00.000Z",
        status: "succeeded",
        tasks: {},
        agents: [],
      };
      mockRuns.set(runPath, state);
    }
    mutator(state);
    return {
      event_id: "evt-mock",
    } as unknown as import("../../../../olt/scripts/src/core/contracts/index.ts").HarnessEvent;
  });
});

function fileProposal(run: string, statement: string): { readonly candidate_id: string } {
  return mindCandidateCommand({
    run,
    actor: "mind-1",
    kind: "proposal",
    statement,
    "charter-goal": ["G1"],
    "write-scope": ["src/x.ts"],
  }) as { readonly candidate_id: string };
}

function candidateStatus(run: string, candidateId: string): unknown {
  const loaded = storeModule.loadRun(run, true);
  const candidates = (
    Array.isArray(loaded.state.candidates) ? loaded.state.candidates : []
  ) as Record<string, unknown>[];
  return candidates.find((c) => c.id === candidateId)?.status;
}

function setCandidateStatus(run: string, candidateId: string, status: string): void {
  storeModule.transact(
    run,
    "mind-1",
    `set-status-${status}`,
    { candidate_id: candidateId },
    (working) => {
      const list = (Array.isArray(working.candidates) ? working.candidates : []) as Record<
        string,
        unknown
      >[];
      const found = list.find((c) => c.id === candidateId);
      if (found) found.status = status;
    },
  );
}

describe("candidate decline reachability (cand-11 wedge) in-memory virtual", () => {
  test("1. proposal cap fires once max_open_proposals is reached", () => {
    const { run } = setupReachabilityTest("cap-fires");
    for (let i = 0; i < MAX_OPEN_PROPOSALS; i++) {
      const { candidate_id } = fileProposal(run, `proposal statement ${i}`);
      expect(candidateStatus(run, candidate_id)).toBe("open");
    }
    let caught: HarnessError | null = null;
    try {
      fileProposal(run, "one proposal too many");
    } catch (err) {
      if (err instanceof HarnessError) caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("INVALID_STATE");
    expect(caught?.message).toContain("open proposals cap reached");
  });

  test("2+3. declining an open candidate succeeds and intake recovers in-band", async () => {
    const { run } = setupReachabilityTest("decline-recovers");
    const first = fileProposal(run, "proposal statement 0");
    for (let i = 1; i < MAX_OPEN_PROPOSALS; i++) fileProposal(run, `proposal statement ${i}`);
    expect(() => fileProposal(run, "blocked by cap")).toThrow(HarnessError);

    const targetId = first.candidate_id;
    expect(candidateStatus(run, targetId)).toBe("open");
    const declineResult = await mindDeclineCommand({
      run,
      actor: "mind-1",
      candidate: targetId,
      reason: "superseded by a better proposal",
    });
    expect(declineResult.candidate_id).toBe(targetId);
    expect(candidateStatus(run, targetId)).toBe("declined");

    const { candidate_id: recovered } = fileProposal(run, "recovered after decline");
    expect(candidateStatus(run, recovered)).toBe("open");
  });

  test("4. declining a genuinely terminal status (declined, completed) is still refused", async () => {
    const { run } = setupReachabilityTest("terminal-refused");
    const { candidate_id } = fileProposal(run, "will be declined once");
    await mindDeclineCommand({
      run,
      actor: "mind-1",
      candidate: candidate_id,
      reason: "first decline",
    });
    expect(candidateStatus(run, candidate_id)).toBe("declined");

    let caughtDeclined: HarnessError | null = null;
    try {
      await mindDeclineCommand({
        run,
        actor: "mind-1",
        candidate: candidate_id,
        reason: "second decline attempt",
      });
    } catch (err) {
      if (err instanceof HarnessError) caughtDeclined = err;
    }
    expect(caughtDeclined).not.toBeNull();
    expect(caughtDeclined?.code).toBe("INVALID_STATE");

    const { candidate_id: completedId } = fileProposal(run, "will be marked completed");
    setCandidateStatus(run, completedId, "completed");

    let caughtCompleted: HarnessError | null = null;
    try {
      await mindDeclineCommand({
        run,
        actor: "mind-1",
        candidate: completedId,
        reason: "should be refused",
      });
    } catch (err) {
      if (err instanceof HarnessError) caughtCompleted = err;
    }
    expect(caughtCompleted).not.toBeNull();
    expect(caughtCompleted?.code).toBe("INVALID_STATE");
  });

  test("5. decline from 'granted' and from 'admitted' is allowed, matching VALID_PROPOSAL_TRANSITIONS", async () => {
    const { run } = setupReachabilityTest("granted-admitted-allowed");
    const { candidate_id: grantedId } = fileProposal(run, "will be granted then declined");
    setCandidateStatus(run, grantedId, "granted");
    expect(candidateStatus(run, grantedId)).toBe("granted");
    await mindDeclineCommand({
      run,
      actor: "mind-1",
      candidate: grantedId,
      reason: "owner revoked the grant",
    });
    expect(candidateStatus(run, grantedId)).toBe("declined");

    const { candidate_id: admittedId } = fileProposal(run, "will be admitted then declined");
    setCandidateStatus(run, admittedId, "admitted");
    expect(candidateStatus(run, admittedId)).toBe("admitted");
    await mindDeclineCommand({
      run,
      actor: "mind-1",
      candidate: admittedId,
      reason: "revoked before work started",
    });
    expect(candidateStatus(run, admittedId)).toBe("declined");
  });
});
