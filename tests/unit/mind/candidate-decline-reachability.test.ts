import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { mindCandidateCommand } from "../../../olt/scripts/src/cli/commands/mind-candidate.ts";
import { mindDeclineCommand } from "../../../olt/scripts/src/cli/commands/mind-admit.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

// This suite proves the cand-11 wedge (mind-admit.ts:287-291 rejecting decline on
// status "open", which is the exact status the proposal cap in mind-candidate.ts
// counts) is closed end to end: cap fires, decline on "open" succeeds, and intake
// recovers in-band afterwards. It also pins the boundary of the fixed guard against
// VALID_PROPOSAL_TRANSITIONS (declared in mind/proposal.ts) so a future status
// cannot silently re-wedge the queue.

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempRoots.length = 0;
});

const MAX_OPEN_PROPOSALS = 3;

function setupReachabilityTest(name: string): { readonly repo: string; readonly run: string } {
  const repo = mkdtempSync(join(tmpdir(), `mind-decline-reach-${name}-`));
  tempRoots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    'name: "mind"\nrole: "mind"\ncharter:\n  identity: "Candidate decline reachability suite"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n  non_goals:\n    - "Out of scope"\n  repo_roots:\n    - "src/"\n';
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-decline-reach-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1"],
          non_goals: ["Out of scope"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
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
      };
    },
  );

  agentRegisterCommand({
    run,
    agent: "mind-1",
    role: "mind",
    host: "antigravity",
  });

  return { repo, run };
}

function fileProposal(run: string, statement: string): { readonly candidate_id: string } {
  const result = mindCandidateCommand({
    run,
    actor: "mind-1",
    kind: "proposal",
    statement,
    "charter-goal": ["G1"],
    "write-scope": ["src/x.ts"],
  }) as { readonly candidate_id: string };
  return result;
}

function candidateStatus(run: string, candidateId: string): unknown {
  const loaded = loadRun(run, true);
  const candidates = (
    Array.isArray(loaded.state.candidates) ? loaded.state.candidates : []
  ) as Record<string, unknown>[];
  const found = candidates.find((c) => c.id === candidateId);
  return found?.status;
}

describe("candidate decline reachability (cand-11 wedge)", () => {
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
    for (let i = 1; i < MAX_OPEN_PROPOSALS; i++) {
      fileProposal(run, `proposal statement ${i}`);
    }

    // Cap is live: filing one more must fail before we touch decline.
    expect(() => fileProposal(run, "blocked by cap")).toThrow(HarnessError);

    // Load-bearing assertion: decline on status "open" must SUCCEED, not throw
    // "already decided". This is precisely the cand-11 wedge.
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

    // Intake recovered in-band: filing a new proposal now succeeds because the
    // declined candidate no longer counts against the open-proposal cap.
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

    // Re-declining an already-declined candidate must still be refused: "declined"
    // has no successors in VALID_PROPOSAL_TRANSITIONS, so this is a real terminal.
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

    // "completed" is the other empty-successor-set terminal in the declared state
    // machine; a candidate parked there must also refuse decline.
    const { candidate_id: completedId } = fileProposal(run, "will be marked completed");
    transact(
      run,
      "mind-1",
      "mind-candidate-completed-for-test",
      { candidate_id: completedId },
      (working) => {
        const candidates = (Array.isArray(working.candidates) ? working.candidates : []) as Record<
          string,
          unknown
        >[];
        const found = candidates.find((c) => c.id === completedId);
        if (found) found.status = "completed";
      },
    );

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
    transact(
      run,
      "mind-1",
      "mind-candidate-granted-for-test",
      { candidate_id: grantedId },
      (working) => {
        const candidates = (Array.isArray(working.candidates) ? working.candidates : []) as Record<
          string,
          unknown
        >[];
        const found = candidates.find((c) => c.id === grantedId);
        if (found) found.status = "granted";
      },
    );
    expect(candidateStatus(run, grantedId)).toBe("granted");
    await mindDeclineCommand({
      run,
      actor: "mind-1",
      candidate: grantedId,
      reason: "owner revoked the grant",
    });
    expect(candidateStatus(run, grantedId)).toBe("declined");

    const { candidate_id: admittedId } = fileProposal(run, "will be admitted then declined");
    transact(
      run,
      "mind-1",
      "mind-candidate-admitted-for-test",
      { candidate_id: admittedId },
      (working) => {
        const candidates = (Array.isArray(working.candidates) ? working.candidates : []) as Record<
          string,
          unknown
        >[];
        const found = candidates.find((c) => c.id === admittedId);
        if (found) found.status = "admitted";
      },
    );
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
