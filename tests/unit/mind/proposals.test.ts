import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertRoleMayDecideProposal,
  checkProposalRateLimits,
  decideProposal,
  findDeclinedProposalConflict,
  formatProposalBrief,
  getAllProposals,
  getDeclinedProposals,
  getGrantedProposals,
  getOpenProposals,
  isProposalAdmissible,
  isProposalGranted,
  PROPOSAL_WITNESS_OWNER_DECISION,
  recordProposal,
} from "../../../olt/scripts/src/mind/proposal.ts";
import { assertRoleMayInvoke } from "../../../olt/scripts/src/packets/command-authority.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // cleanup error ignored
    }
  }
  roots.length = 0;
});

interface MindTestFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
  } = {},
): MindTestFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-proposals-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Discovery test mind"\n  goals:\n    - id: "G1"\n      statement: "Discovery and Judgment"\n    - id: "G2"\n      statement: "High Quality Substrate"\n  non_goals:\n    - "Unsupervised writes"\n  repo_roots:\n    - "src/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

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
          goals: ["G1", "G2"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 1,
        wall_clock_ms_today: 60_000,
        ...(overrides.budget ?? {}),
      };

      working.pulse = {
        counter: 1,
        open: {
          pulse_id: "pulse-1",
          actor: "mind-1",
          opened_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 1_200_000).toISOString(),
          host: "antigravity",
          driver: "manual",
        },
        last: null,
      };

      working.candidates = [];
      working.requirements = [];
    },
  );

  return { repo, run, charterPath, charterSha };
}

describe("mind/proposal.ts - Proposal Lifecycle and Invariants", () => {
  test("proposals without witnesses accepted: creates needs_authority proposal and requirement", () => {
    const fixture = setupMindCapsule("no-witness-accepted");

    const proposal = recordProposal(fixture.run, {
      statement: "Add automated semantic caching to reduce token spend",
      rationale: "Analysis indicates 30% of prompts repeat identical static queries",
      charter_goal_ids: ["G1"],
      write_scope: ["src/cache/"],
      actor: "mind-1",
      pulseId: "pulse-1",
    });

    expect(proposal.id).toBeDefined();
    expect(proposal.kind).toBe("proposal");
    expect(proposal.status).toBe("needs_authority");
    expect(proposal.disposition).toBe("needs_authority");
    expect(proposal.witness).toBeNull();
    expect(proposal.witness_command_id).toBeNull();
    expect(proposal.evidence_class).toBe("agent_reported");
    expect(proposal.statement).toBe("Add automated semantic caching to reduce token spend");
    expect(proposal.charter_goal_ids).toEqual(["G1"]);

    // Verify durable projection
    const loaded = loadRun(fixture.run, false);
    const candidates = getAllProposals(loaded.state);
    expect(candidates.length).toBe(1);
    expect(candidates[0]?.id).toBe(proposal.id);
    expect(candidates[0]?.status).toBe("needs_authority");

    const open = getOpenProposals(loaded.state);
    expect(open.length).toBe(1);
    expect(open[0]?.id).toBe(proposal.id);

    // Verify corresponding requirement in state
    const reqList = (loaded.state.requirements ?? []) as Record<string, unknown>[];
    expect(reqList.length).toBe(1);
    expect(reqList[0]?.id).toBe(proposal.requirement_id);
    expect(reqList[0]?.disposition).toBe("needs_authority");
  });

  test("proposals with witnesses are refused upon creation", () => {
    const fixture = setupMindCapsule("witness-refused");

    expect(() =>
      recordProposal(fixture.run, {
        statement: "Add caching layer",
        rationale: "Performance boost",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        witness: "cmd-12345",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      recordProposal(fixture.run, {
        statement: "Add caching layer 2",
        rationale: "Performance boost",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        witness_command_id: "cmd-12345",
      }),
    ).toThrow(HarnessError);

    const loaded = loadRun(fixture.run, false);
    expect(getAllProposals(loaded.state).length).toBe(0);
  });

  test("proposal input validation: rejects blank statement, rationale, or missing goals", () => {
    const fixture = setupMindCapsule("input-validation");

    expect(() =>
      recordProposal(fixture.run, {
        statement: "   ",
        rationale: "Some rationale",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      recordProposal(fixture.run, {
        statement: "Valid statement",
        rationale: "",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
      }),
    ).toThrow(HarnessError);

    expect(() =>
      recordProposal(fixture.run, {
        statement: "Valid statement",
        rationale: "Valid rationale",
        charter_goal_ids: [],
        actor: "mind-1",
      }),
    ).toThrow(HarnessError);
  });

  test("proposals exceeding ceiling are refused", () => {
    const fixture = setupMindCapsule("ceiling-refused", {
      budget: { max_open_proposals: 2 },
    });

    const now1 = new Date("2026-08-21T01:00:00.000Z");
    const now2 = new Date("2026-08-22T01:00:00.000Z");
    const now3 = new Date("2026-08-23T01:00:00.000Z");

    // 1st proposal succeeds
    recordProposal(fixture.run, {
      id: "prop-1",
      statement: "First novel proposal",
      rationale: "Rationale 1",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      now: now1,
      minIntervalMs: 0,
      maxOpenProposals: 2,
    });

    // 2nd proposal succeeds (different day/pulse)
    recordProposal(fixture.run, {
      id: "prop-2",
      statement: "Second novel proposal",
      rationale: "Rationale 2",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-2",
      now: now2,
      minIntervalMs: 0,
      maxOpenProposals: 2,
    });

    const midState = loadRun(fixture.run, false).state;
    expect(getOpenProposals(midState).length).toBe(2);

    // 3rd proposal refused due to ceiling of 2
    let error: HarnessError | null = null;
    try {
      recordProposal(fixture.run, {
        id: "prop-3",
        statement: "Third novel proposal",
        rationale: "Rationale 3",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-3",
        now: now3,
        minIntervalMs: 0,
        maxOpenProposals: 2,
      });
    } catch (err) {
      if (err instanceof HarnessError) error = err;
    }

    expect(error).not.toBeNull();
    expect(error?.code).toBe("INVALID_STATE");
    expect(error?.message).toContain("open proposal ceiling reached (2/2)");

    // Ensure state remained intact with only 2 proposals
    const finalState = loadRun(fixture.run, false).state;
    expect(getAllProposals(finalState).length).toBe(2);
  });

  test("proposals exceeding pulse/interval rate limit are refused", () => {
    const fixture = setupMindCapsule("interval-refused");

    const t0 = "2026-08-21T02:00:00.000Z";
    const tSamePulse = "2026-08-21T02:05:00.000Z";
    const tTooSoon = "2026-08-21T08:00:00.000Z"; // 6 hours later (< 24h)

    // 1st proposal in pulse-1
    recordProposal(fixture.run, {
      id: "prop-1",
      statement: "First novel feature proposal",
      rationale: "High value discovery",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      now: t0,
    });

    // 2nd proposal in same pulse is refused
    expect(() =>
      recordProposal(fixture.run, {
        id: "prop-2",
        statement: "Another proposal in same pulse",
        rationale: "High value discovery 2",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        now: tSamePulse,
      }),
    ).toThrow(HarnessError);

    // 3rd proposal in pulse-2 but within 24h interval is refused
    let intervalError: HarnessError | null = null;
    try {
      recordProposal(fixture.run, {
        id: "prop-3",
        statement: "Proposal 6 hours later",
        rationale: "High value discovery 3",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-2",
        now: tTooSoon,
        minIntervalMs: 86_400_000,
      });
    } catch (err) {
      if (err instanceof HarnessError) intervalError = err;
    }

    expect(intervalError).not.toBeNull();
    expect(intervalError?.code).toBe("INVALID_STATE");
    expect(intervalError?.message).toContain("proposal rate limit exceeded");

    // 4th proposal 25 hours later succeeds
    const tEligible = "2026-08-22T04:00:00.000Z";
    const prop4 = recordProposal(fixture.run, {
      id: "prop-4",
      statement: "Proposal 26 hours later",
      rationale: "High value discovery 4",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-3",
      now: tEligible,
      minIntervalMs: 86_400_000,
    });
    expect(prop4.id).toBe("prop-4");
  });

  test("duplicate open proposals are refused", () => {
    const fixture = setupMindCapsule("duplicate-open");

    recordProposal(fixture.run, {
      id: "prop-1",
      statement: "Implement background vector sync",
      rationale: "Rationale A",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      minIntervalMs: 0,
    });

    expect(() =>
      recordProposal(fixture.run, {
        id: "prop-2",
        statement: "implement background vector sync  ",
        rationale: "Rationale B",
        charter_goal_ids: ["G2"],
        actor: "mind-1",
        pulseId: "pulse-2",
        minIntervalMs: 0,
      }),
    ).toThrow(HarnessError);
  });

  test("proposal granted transitions to admissible with witness: owner-decision", () => {
    const fixture = setupMindCapsule("grant-lifecycle");

    const proposal = recordProposal(fixture.run, {
      id: "prop-grant-1",
      statement: "Add cross-capsule query engine",
      rationale: "Enables fast cross-run indexing",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      minIntervalMs: 0,
    });

    expect(isProposalGranted(proposal)).toBe(false);
    expect(isProposalAdmissible(proposal)).toBe(false);

    // Owner approves the proposal
    const granted = decideProposal(fixture.run, proposal.id, "owner-alice", {
      decision: "grant",
      rationale: "Approved for exploration in next cycle",
    });

    expect(granted.status).toBe("granted");
    expect(granted.disposition).toBe("actionable");
    expect(granted.witness).toBe(PROPOSAL_WITNESS_OWNER_DECISION);
    expect(granted.witness_command_id).toBe(PROPOSAL_WITNESS_OWNER_DECISION);
    expect(granted.decided_by).toBe("owner-alice");
    expect(granted.decided_at).toBeDefined();
    expect(granted.rationale).toBe("Approved for exploration in next cycle");

    expect(isProposalGranted(granted)).toBe(true);
    expect(isProposalAdmissible(granted)).toBe(true);

    // Verify durable state
    const loaded = loadRun(fixture.run, false);
    const grantedList = getGrantedProposals(loaded.state);
    expect(grantedList.length).toBe(1);
    expect(grantedList[0]?.id).toBe(proposal.id);

    const openList = getOpenProposals(loaded.state);
    expect(openList.length).toBe(0);

    const reqList = (loaded.state.requirements ?? []) as Record<string, unknown>[];
    expect(reqList[0]?.authority_status).toBe("granted");
    expect(reqList[0]?.disposition).toBe("actionable");
  });

  test("declined proposal permanently blocked from re-proposal (Gate 6 duplicate/declined)", () => {
    const fixture = setupMindCapsule("decline-permanent-block");

    const proposal = recordProposal(fixture.run, {
      id: "prop-decline-1",
      statement: "Rewrite storage layer in SQLite",
      rationale: "May improve indexing latency",
      charter_goal_ids: ["G2"],
      actor: "mind-1",
      pulseId: "pulse-1",
      minIntervalMs: 0,
    });

    // Owner declines the proposal
    const declined = decideProposal(fixture.run, proposal.id, "owner-alice", {
      decision: "decline",
      rationale: "Out of scope: filesystem JSONL chain is non-negotiable substrate",
    });

    expect(declined.status).toBe("declined");
    expect(declined.disposition).toBe("out_of_scope");
    expect(declined.decline_reason).toBe(
      "Out of scope: filesystem JSONL chain is non-negotiable substrate",
    );
    expect(declined.decided_by).toBe("owner-alice");
    expect(isProposalAdmissible(declined)).toBe(false);

    const state = loadRun(fixture.run, false).state;
    const declinedList = getDeclinedProposals(state);
    expect(declinedList.length).toBe(1);
    expect(declinedList[0]?.id).toBe(proposal.id);

    // Check findDeclinedProposalConflict helper
    const conflict = findDeclinedProposalConflict(state, "rewrite storage layer in sqlite");
    expect(conflict).toBeDefined();
    expect(conflict?.id).toBe(proposal.id);

    // Re-proposing identical statement is permanently blocked
    let reProposeError: HarnessError | null = null;
    try {
      recordProposal(fixture.run, {
        id: "prop-repropose",
        statement: "Rewrite storage layer in SQLite",
        rationale: "Trying again tonight with new arguments",
        charter_goal_ids: ["G2"],
        actor: "mind-1",
        pulseId: "pulse-2",
        minIntervalMs: 0,
      });
    } catch (err) {
      if (err instanceof HarnessError) reProposeError = err;
    }

    expect(reProposeError).not.toBeNull();
    expect(reProposeError?.code).toBe("INVALID_STATE");
    expect(reProposeError?.message).toContain(
      "declined proposal permanently blocked from re-proposal",
    );
    expect(reProposeError?.message).toContain(
      "Out of scope: filesystem JSONL chain is non-negotiable substrate",
    );
  });

  test("mind role is strictly refused from calling authority:decide", () => {
    // 1. Direct assertRoleMayDecideProposal check
    expect(() => assertRoleMayDecideProposal("mind", "mind-1")).toThrow(HarnessError);

    try {
      assertRoleMayDecideProposal("mind", "mind-1");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_STATE");
      expect((err as HarnessError).message).toContain(
        "role mind may not invoke authority:decide: agent mind-1 holds a mind grant and cannot self-approve proposals",
      );
    }

    // 2. Role contract check via command authority
    expect(() =>
      assertRoleMayInvoke("mind", { name: "authority:decide", aliases: [] }, "mind-1"),
    ).toThrow(HarnessError);

    // 3. decideProposal with mind role throws
    const fixture = setupMindCapsule("mind-self-approval-blocked");
    const proposal = recordProposal(fixture.run, {
      statement: "Self approved proposal",
      rationale: "Mind attempts to approve its own idea",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      minIntervalMs: 0,
    });

    expect(() =>
      decideProposal(
        fixture.run,
        proposal.id,
        "mind-1",
        {
          decision: "grant",
          rationale: "I approve my own proposal",
        },
        { actorRole: "mind" },
      ),
    ).toThrow(HarnessError);
  });

  test("deciding an already decided proposal is refused", () => {
    const fixture = setupMindCapsule("double-decide");
    const proposal = recordProposal(fixture.run, {
      statement: "Single decision proposal",
      rationale: "Checking idempotence",
      charter_goal_ids: ["G1"],
      actor: "mind-1",
      pulseId: "pulse-1",
      minIntervalMs: 0,
    });

    decideProposal(fixture.run, proposal.id, "owner-bob", {
      decision: "grant",
      rationale: "Approved",
    });

    expect(() =>
      decideProposal(fixture.run, proposal.id, "owner-bob", {
        decision: "decline",
        rationale: "Changed mind",
      }),
    ).toThrow(HarnessError);
  });

  test("checkProposalRateLimits and formatProposalBrief helpers work as expected", () => {
    const dummyState: Record<string, unknown> = {
      budget: { max_open_proposals: 3, proposal_interval_ms: 3_600_000 },
      candidates: [
        {
          id: "prop-alpha",
          kind: "proposal",
          statement: "Alpha proposal",
          rationale: "Alpha rationale",
          charter_goal_ids: ["G1"],
          status: "needs_authority",
          disposition: "needs_authority",
          requirement_id: "req-prop-alpha",
          created_at: "2026-08-21T01:00:00.000Z",
          created_pulse: "pulse-1",
          evidence_class: "agent_reported",
        },
      ],
    };

    const status1 = checkProposalRateLimits(dummyState, {
      now: "2026-08-21T01:30:00.000Z", // only 30m later
      pulseId: "pulse-2",
    });
    expect(status1.allowed).toBe(false);
    expect(status1.reason).toContain("proposal rate limit exceeded");

    const status2 = checkProposalRateLimits(dummyState, {
      now: "2026-08-21T03:00:00.000Z", // 2h later (> 1h)
      pulseId: "pulse-2",
    });
    expect(status2.allowed).toBe(true);
    expect(status2.openCount).toBe(1);
    expect(status2.maxOpen).toBe(3);

    const prop = getAllProposals(dummyState)[0]!;
    const brief = formatProposalBrief(prop);
    expect(brief).toContain("Proposal: `prop-alpha`");
    expect(brief).toContain("**Status**: NEEDS_AUTHORITY");
    expect(brief).toContain('**Statement**: "Alpha proposal"');
  });
});
