import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatMindPulseCloseBrief,
  mindPulseCloseCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-pulse-close.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  readLastPulse,
  reconcileLastPulse,
  writeLastPulse,
} from "../../../orchestrating-long-tasks/scripts/src/mind/last-pulse.ts";
import {
  calculateNextWakeInterval,
  calculatePulseValue,
  calculateQuiescentBackoffInterval,
  isPulseOutcome,
  isTerminalOutcome,
  parseDuration,
  PULSE_OUTCOMES,
} from "../../../orchestrating-long-tasks/scripts/src/mind/value.ts";
import {
  assessRecyclingState,
  enforceInfiniteMindCadence,
  extractAllCandidates,
  formatRecycleBrief,
  planAutonomousRoundRecycle,
  transitionCompletenessCriticSignOff,
  transitionPulseCloseToWake,
} from "../../../orchestrating-long-tasks/scripts/src/mind/recycler.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  roots.length = 0;
});

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseLast?: Record<string, unknown> | null;
    readonly budget?: Record<string, unknown>;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-pulse-close-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    overrides.charterContent ??
    `# CHARTER\n\n## identity\nTest mind\n\n## goals\n- G1: Stability\n\n## non-goals\n- Out of scope\n\n## repo_roots\n- \`src/\`\n`;
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
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["docs/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000, // 15m
        max_interval_ms: 14_400_000, // 4h
        max_pause_interval_ms: 1_800_000, // 30m
        pulse_deadline_ms: 1_200_000, // 20m
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 1,
        wall_clock_ms_today: 60_000,
        ...(overrides.budget ?? {}),
      };

      working.pulse = {
        counter: 1,
        open:
          overrides.pulseOpen !== undefined
            ? overrides.pulseOpen
            : {
                pulse_id: "pulse-1",
                actor: "mind-1",
                opened_at: new Date(Date.now() - 60_000).toISOString(),
                deadline_at: new Date(Date.now() + 1_140_000).toISOString(),
                host: "antigravity",
                driver: "manual",
              },
        last: overrides.pulseLast !== undefined ? overrides.pulseLast : null,
      };
    },
  );

  writeLastPulse(run, {
    at: new Date().toISOString(),
    pulse_id: null,
    outcome: null,
    next_wake_at: null,
  });

  return { repo, run, charterPath, charterSha };
}

describe("value.ts - Pure Value and Interval Calculations", () => {
  test("calculatePulseValue: sums measured terms and caps proposals at 1", () => {
    const val1 = calculatePulseValue({
      leases_reclaimed: 2,
      findings_resolved: 3,
      gates_flipped_red_to_green: 1,
      tasks_reaching_done: 4,
      candidates_admitted: 2,
      proposals_recorded: 1,
    });
    expect(val1).toBe(2 + 3 + 1 + 4 + 2 + 1); // 13

    // Proposal cap at 1 per pulse
    const valWithManyProposals = calculatePulseValue({
      proposals_recorded: 5,
    });
    expect(valWithManyProposals).toBe(1);

    // Empty object returns 0
    expect(calculatePulseValue({})).toBe(0);
  });

  test("calculatePulseValue: explicitly ignores excluded metrics (tokens, files, agents, commands)", () => {
    const val = calculatePulseValue({
      leases_reclaimed: 1,
      files_touched: 50,
      commands_run: 200,
      tokens_spent: 100_000,
      agents_deployed: 10,
      words_written: 5000,
    });
    // Only leases_reclaimed should count
    expect(val).toBe(1);
  });

  test("parseDuration: parses various units and numbers correctly", () => {
    expect(parseDuration(1000)).toBe(1000);
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("4h")).toBe(14_400_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("900000")).toBe(900_000);

    expect(() => parseDuration("invalid")).toThrow(HarnessError);
    expect(() => parseDuration(-5)).toThrow(HarnessError);
  });

  test("calculateQuiescentBackoffInterval: table test over streak progression up to cap", () => {
    const base = 900_000; // 15m
    const max = 14_400_000; // 4h (16 * base)

    expect(calculateQuiescentBackoffInterval(base, max, 0)).toBe(900_000); // 15m
    expect(calculateQuiescentBackoffInterval(base, max, 1)).toBe(1_350_000); // 22.5m (1.5 * 15m)
    expect(calculateQuiescentBackoffInterval(base, max, 2)).toBe(2_025_000); // 33.75m (2.25 * 15m)
    expect(calculateQuiescentBackoffInterval(base, max, 3)).toBe(3_037_500); // ~50.6m
    expect(calculateQuiescentBackoffInterval(base, max, 4)).toBe(4_556_250); // ~75.9m
    expect(calculateQuiescentBackoffInterval(base, max, 5)).toBe(6_834_375); // ~113.9m
    expect(calculateQuiescentBackoffInterval(base, max, 6)).toBe(10_251_563); // ~170.8m
    expect(calculateQuiescentBackoffInterval(base, max, 7)).toBe(max); // capped at 14.4M (4h)
    expect(calculateQuiescentBackoffInterval(base, max, 10)).toBe(max); // capped at 14.4M (4h)
  });

  test("calculateNextWakeInterval: value > 0 resets interval and zero_value_streak", () => {
    const res = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 4,
      value: 2,
      outcome: "rescued",
    });
    expect(res.isTerminal).toBe(false);
    expect(res.rawIntervalMs).toBe(900_000);
    expect(res.intervalMs).toBe(900_000);
    expect(res.zeroValueStreak).toBe(0);
  });

  test("calculateNextWakeInterval: value == 0 increments streak and backs off", () => {
    const res = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 0,
      value: 0,
      outcome: "quiescent",
    });
    expect(res.isTerminal).toBe(false);
    expect(res.zeroValueStreak).toBe(1);
    expect(res.rawIntervalMs).toBe(1_350_000);
  });

  test("calculateNextWakeInterval: rate_limit / paused doubles previous interval up to maxPauseIntervalMs", () => {
    const res = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      maxPauseIntervalMs: 1_800_000,
      previousIntervalMs: 900_000,
      zeroValueStreak: 1,
      value: 0,
      outcome: "paused",
      signal: "rate_limit",
    });
    expect(res.isTerminal).toBe(false);
    expect(res.rawIntervalMs).toBe(1_800_000); // 900_000 * 2 = 1_800_000 (capped at maxPause)
  });

  test("calculateNextWakeInterval: terminal outcomes return null interval", () => {
    const haltedRes = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 1,
      value: 0,
      outcome: "halted",
    });
    expect(haltedRes.isTerminal).toBe(true);
    expect(haltedRes.intervalMs).toBeNull();

    const unarmedRes = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 1,
      value: 0,
      outcome: "unarmed",
    });
    expect(unarmedRes.isTerminal).toBe(true);
    expect(unarmedRes.intervalMs).toBeNull();
  });

  test("calculateNextWakeInterval: applies deterministic jitter when random provided", () => {
    const resMaxJitter = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 0,
      value: 1,
      applyJitter: true,
      random: () => 1.0, // +10% jitter
      jitterRatio: 0.1,
    });
    expect(resMaxJitter.intervalMs).toBe(990_000);

    const resMinJitter = calculateNextWakeInterval({
      baseIntervalMs: 900_000,
      maxIntervalMs: 14_400_000,
      zeroValueStreak: 0,
      value: 1,
      applyJitter: true,
      random: () => 0.0, // -10% jitter
      jitterRatio: 0.1,
    });
    expect(resMinJitter.intervalMs).toBe(810_000);
  });
});

describe("last-pulse.ts - Durable File Persistence & Reconciliation", () => {
  test("writeLastPulse and readLastPulse correctly write and read JSON", () => {
    const fixture = setupMindCapsule("last-pulse-read-write");
    const testRecord = {
      at: "2026-08-21T05:00:00.000Z",
      pulse_id: "pulse-42",
      outcome: "quiescent",
      next_wake_at: "2026-08-21T05:15:00.000Z",
    };

    writeLastPulse(fixture.run, testRecord);
    const read = readLastPulse(fixture.run);
    expect(read).toEqual(testRecord);
  });

  test("reconcileLastPulse: detects discrepancy and rewrites last_pulse.json from chain", () => {
    const fixture = setupMindCapsule("reconcile", {
      pulseLast: {
        pulse_id: "pulse-10",
        outcome: "advanced",
        closed_at: "2026-08-21T04:00:00.000Z",
        next_wake_at: "2026-08-21T04:15:00.000Z",
      },
    });

    // Write a corrupted/stale last_pulse.json
    writeLastPulse(fixture.run, {
      at: "2026-08-21T03:00:00.000Z",
      pulse_id: "stale-pulse",
      outcome: "crashed",
      next_wake_at: null,
    });

    const loaded = loadRun(fixture.run, false);
    const recResult = reconcileLastPulse(fixture.run, loaded.state);
    expect(recResult.reconciled).toBe(true);
    expect(recResult.record.pulse_id).toBe("pulse-10");
    expect(recResult.record.outcome).toBe("advanced");

    // Verify disk file was overwritten with chain's truth
    const onDisk = readLastPulse(fixture.run);
    expect(onDisk?.pulse_id).toBe("pulse-10");
    expect(onDisk?.outcome).toBe("advanced");
  });
});

describe("mindPulseCloseCommand - Refusals and Arming Rail", () => {
  test("refuses when no pulse is open and preserves event_sequence", async () => {
    const fixture = setupMindCapsule("no-open", { pulseOpen: null });
    const initialLoaded = loadRun(fixture.run, false);
    const initialSeq = initialLoaded.state.event_sequence;

    expect(
      mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
      }),
    ).rejects.toThrow(HarnessError);

    const postLoaded = loadRun(fixture.run, false);
    expect(postLoaded.state.event_sequence).toBe(initialSeq);
  });

  test("refuses when pulse id does not match open pulse and preserves event_sequence", async () => {
    const fixture = setupMindCapsule("mismatched-id", {
      pulseOpen: {
        pulse_id: "pulse-1",
        actor: "mind-1",
      },
    });
    const initialLoaded = loadRun(fixture.run, false);
    const initialSeq = initialLoaded.state.event_sequence;

    expect(
      mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-999",
        outcome: "quiescent",
        arm: "15m",
      }),
    ).rejects.toThrow(HarnessError);

    const postLoaded = loadRun(fixture.run, false);
    expect(postLoaded.state.event_sequence).toBe(initialSeq);
  });

  test("refuses when actor does not match open pulse actor and preserves event_sequence", async () => {
    const fixture = setupMindCapsule("mismatched-actor", {
      pulseOpen: {
        pulse_id: "pulse-1",
        actor: "mind-1",
      },
    });
    const initialLoaded = loadRun(fixture.run, false);
    const initialSeq = initialLoaded.state.event_sequence;

    expect(
      mindPulseCloseCommand({
        run: fixture.run,
        actor: "imposter-actor",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
      }),
    ).rejects.toThrow(HarnessError);

    const postLoaded = loadRun(fixture.run, false);
    expect(postLoaded.state.event_sequence).toBe(initialSeq);
  });

  test("refuses invalid outcome outside the eleven permitted outcomes", async () => {
    const fixture = setupMindCapsule("invalid-outcome");
    const initialLoaded = loadRun(fixture.run, false);
    const initialSeq = initialLoaded.state.event_sequence;

    expect(
      mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "some-random-outcome",
        arm: "15m",
      }),
    ).rejects.toThrow(HarnessError);

    const postLoaded = loadRun(fixture.run, false);
    expect(postLoaded.state.event_sequence).toBe(initialSeq);
  });

  test("arming rail: refuses non-terminal outcome when neither --arm nor --terminal-reason is provided", async () => {
    const fixture = setupMindCapsule("arming-rail-refusal");
    const initialLoaded = loadRun(fixture.run, false);
    const initialSeq = initialLoaded.state.event_sequence;

    let caughtError: HarnessError | null = null;
    try {
      await mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "quiescent",
      });
    } catch (err) {
      if (err instanceof HarnessError) caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toContain("--arm");
    expect(caughtError?.message).toContain("--terminal-reason");
    expect(caughtError?.message).toContain("--outcome unarmed");

    const postLoaded = loadRun(fixture.run, false);
    expect(postLoaded.state.event_sequence).toBe(initialSeq);
  });

  test("double-close refusal: after a pulse is closed, a second close is refused", async () => {
    const fixture = setupMindCapsule("double-close");

    // First close succeeds
    await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "quiescent",
      arm: "15m",
    });

    const midLoaded = loadRun(fixture.run, false);
    const midSeq = midLoaded.state.event_sequence;

    // Second close is refused
    expect(
      mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
      }),
    ).rejects.toThrow(HarnessError);

    const finalLoaded = loadRun(fixture.run, false);
    expect(finalLoaded.state.event_sequence).toBe(midSeq);
  });
});

describe("mindPulseCloseCommand - Successful Closures & Invariant Checks", () => {
  test("closes quiescent pulse with --arm and writes last_pulse.json", async () => {
    const fixture = setupMindCapsule("close-quiescent");
    const now = "2026-08-21T05:00:00.000Z";

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "quiescent",
      arm: "15m",
      "arm-mechanism": "systemd-timer",
      now,
    });

    expect(result.outcome).toBe("quiescent");
    expect(result.value).toBe(0);
    expect(result.armed_interval_ms).toBe(900_000);
    expect(result.arm_mechanism).toBe("systemd-timer");
    expect(result.next_wake_at).toBe("2026-08-21T05:15:00.000Z");
    expect(result.zero_value_streak).toBe(1);

    const loaded = loadRun(fixture.run, false);
    const pulseState = (loaded.state.pulse ?? {}) as Record<string, unknown>;
    expect(pulseState.open).toBeUndefined();
    expect(pulseState.last).toBeDefined();

    const last = pulseState.last as Record<string, unknown>;
    expect(last.pulse_id).toBe("pulse-1");
    expect(last.outcome).toBe("quiescent");
    expect(last.value).toBe(0);
    expect(last.zero_value_streak).toBe(1);

    const lastPulse = readLastPulse(fixture.run);
    expect(lastPulse?.pulse_id).toBe("pulse-1");
    expect(lastPulse?.outcome).toBe("quiescent");
    expect(lastPulse?.next_wake_at).toBe("2026-08-21T05:15:00.000Z");
  });

  test("closes paused pulse with --signal rate_limit and multiplier", async () => {
    const fixture = setupMindCapsule("close-paused");
    const now = "2026-08-21T05:00:00.000Z";

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "paused",
      signal: "rate_limit",
      arm: "30m",
      now,
    });

    expect(result.outcome).toBe("paused");
    expect(result.armed_interval_ms).toBe(1_800_000);
    expect(result.next_wake_at).toBe("2026-08-21T05:30:00.000Z");

    const loaded = loadRun(fixture.run, false);
    const pulseState = (loaded.state.pulse ?? {}) as Record<string, unknown>;
    const last = pulseState.last as Record<string, unknown>;
    expect(last.outcome).toBe("paused");
    expect(last.signal).toBe("rate_limit");
  });

  test("closes halted pulse: does not arm, updates state.mind.halted", async () => {
    const fixture = setupMindCapsule("close-halted");
    const now = "2026-08-21T05:00:00.000Z";

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "halted",
      reason: "charter drift detected",
      now,
    });

    expect(result.outcome).toBe("halted");
    expect(result.next_wake_at).toBeNull();
    expect(result.armed_interval_ms).toBeNull();

    const loaded = loadRun(fixture.run, false);
    const mindState = (loaded.state.mind ?? {}) as Record<string, unknown>;
    expect(mindState.halted).toBe(true);
    expect(mindState.halt_reason).toBe("charter drift detected");

    const lastPulse = readLastPulse(fixture.run);
    expect(lastPulse?.outcome).toBe("halted");
    expect(lastPulse?.next_wake_at).toBeNull();
  });

  test("closes unarmed pulse: permitted without --arm, does not arm", async () => {
    const fixture = setupMindCapsule("close-unarmed");

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "unarmed",
    });

    expect(result.outcome).toBe("unarmed");
    expect(result.next_wake_at).toBeNull();

    const lastPulse = readLastPulse(fixture.run);
    expect(lastPulse?.outcome).toBe("unarmed");
    expect(lastPulse?.next_wake_at).toBeNull();
  });

  test("closes with --terminal-reason for non-terminal outcome without arming", async () => {
    const fixture = setupMindCapsule("terminal-reason-non-arm");

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "escalated",
      "terminal-reason": "waiting on human operator",
    });

    expect(result.outcome).toBe("escalated");
    expect(result.next_wake_at).toBeNull();
  });

  test("formatMindPulseCloseBrief renders clean output within line limit", () => {
    const brief = formatMindPulseCloseBrief({
      pulseId: "pulse-1",
      outcome: "quiescent",
      value: 0,
      nextWakeAt: "2026-08-21T05:15:00.000Z",
      armedIntervalMs: 900_000,
      armMechanism: "systemd-timer",
    });

    expect(brief).toContain("Mind Pulse Closed: pulse-1");
    expect(brief).toContain("**Outcome**: quiescent");
    expect(brief).toContain("**Arm Mechanism**: systemd-timer");
    expect(brief).toContain("**Cadence**: infinite autonomous loop active");
    expect(brief).toContain("**Next Instruction**: `bun harness.ts mind:wake`");
  });

  test("formatMindPulseCloseBrief outputs explicit next instruction for run and candidate", () => {
    const briefWithRun = formatMindPulseCloseBrief({
      pulseId: "pulse-2",
      outcome: "advanced",
      value: 5,
      nextWakeAt: "2026-08-21T05:15:00.000Z",
      armedIntervalMs: 900_000,
      armMechanism: "command-flag",
      runRoot: "/tmp/capsules/mind-gen-test",
    });

    expect(briefWithRun).toContain(
      "**Next Instruction**: `bun harness.ts mind:wake --run /tmp/capsules/mind-gen-test`",
    );

    const briefWithCandidate = formatMindPulseCloseBrief({
      pulseId: "pulse-3",
      outcome: "advanced",
      value: 3,
      nextWakeAt: "2026-08-21T05:15:00.000Z",
      armedIntervalMs: 900_000,
      armMechanism: "command-flag",
      runRoot: "/tmp/capsules/mind-gen-test",
      nextCandidateId: "cand-defect-1",
    });

    expect(briefWithCandidate).toContain(
      "**Next Instruction**: `bun harness.ts mind:admit --run /tmp/capsules/mind-gen-test --candidate cand-defect-1`",
    );
  });

  test("mindPulseCloseCommand returns infinite cadence and routes next instruction to candidate", async () => {
    const fixture = setupMindCapsule("close-infinite-cadence");

    // Add an admitted candidate in state
    transact(
      fixture.run,
      "mind-1",
      "mind-candidate-recorded",
      { id: "cand-auto-1" },
      (working) => {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.candidates = [
          {
            id: "cand-auto-1",
            kind: "defect",
            statement: "Fix defect in test",
            write_scope: ["src/"],
            status: "admitted",
          },
        ];
        working.mind = workingMind as unknown as JsonObject;
      },
    );

    const result = await mindPulseCloseCommand({
      run: fixture.run,
      actor: "mind-1",
      pulse: "pulse-1",
      outcome: "advanced",
      arm: "15m",
    });

    expect(result.cadence).toBe("infinite_autonomous");
    expect(result.next_instruction).toBe(
      `bun harness.ts mind:admit --run ${fixture.run} --candidate cand-auto-1`,
    );
    expect(result.markdown).toContain("infinite autonomous loop active");
    expect(result.markdown).toContain(
      `bun harness.ts mind:admit --run ${fixture.run} --candidate cand-auto-1`,
    );
  });
});

describe("recycler.ts - Autonomous Round-to-Round Recycling Engine", () => {
  test("extractAllCandidates retrieves candidates across state levels", () => {
    const state: Record<string, unknown> = {
      candidates: [
        {
          id: "cand-1",
          kind: "defect",
          statement: "Candidate 1",
          write_scope: ["src/"],
          status: "opened",
        },
      ],
      mind: {
        candidates: [
          {
            id: "cand-2",
            kind: "proposal",
            statement: "Candidate 2",
            write_scope: ["docs/"],
            status: "admitted",
          },
        ],
      },
    };

    const candidates = extractAllCandidates(state);
    expect(candidates.length).toBe(2);
    expect(candidates.map((c) => c.id)).toEqual(["cand-1", "cand-2"]);
  });

  test("transitionCompletenessCriticSignOff: clean review transitions to admitted candidate round opening", () => {
    const state: Record<string, unknown> = {
      completion_review: {
        status: "clean",
        summary: "All requirements met and verified.",
      },
      mind: {
        actor: "mind-1",
        candidates: [
          {
            id: "cand-admitted-1",
            kind: "defect",
            statement: "Implement feature A",
            write_scope: ["src/"],
            status: "admitted",
          },
        ],
      },
    };

    const assessment = transitionCompletenessCriticSignOff(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("candidate_to_planning");
    expect(assessment.candidateId).toBe("cand-admitted-1");
    expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
    expect(assessment.nextRecommendedCommand).toContain("--candidate cand-admitted-1");
    expect(assessment.infiniteCadence).toBe(true);
  });

  test("transitionCompletenessCriticSignOff: clean review transitions to open candidate admission", () => {
    const state: Record<string, unknown> = {
      completion_review: {
        status: "clean",
        summary: "Prior round passed.",
      },
      mind: {
        actor: "mind-1",
        candidates: [
          {
            id: "cand-open-1",
            kind: "defect",
            statement: "Evaluate gate 2",
            write_scope: ["src/"],
            status: "opened",
          },
        ],
      },
    };

    const assessment = transitionCompletenessCriticSignOff(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("discovery_to_admission");
    expect(assessment.candidateId).toBe("cand-open-1");
    expect(assessment.nextRecommendedCommand).toContain("mind:admit");
    expect(assessment.nextRecommendedCommand).toContain("--candidate cand-open-1");
  });

  test("transitionCompletenessCriticSignOff: clean review with no candidates transitions to discovery", () => {
    const state: Record<string, unknown> = {
      completion_review: {
        status: "clean",
        summary: "Finished all objectives.",
      },
      mind: {
        actor: "mind-1",
        candidates: [],
      },
    };

    const assessment = transitionCompletenessCriticSignOff(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("critic_to_discovery");
    expect(assessment.nextRecommendedCommand).toContain("mind:candidate");
    expect(assessment.infiniteCadence).toBe(true);
  });

  test("transitionCompletenessCriticSignOff: findings review with remaining budget opens successor round", () => {
    const state: Record<string, unknown> = {
      completion_review: {
        status: "findings",
        summary: "Found 2 defect findings.",
      },
      budget: {
        max_rounds_per_objective: 3,
      },
      rounds: [
        {
          round_id: "round-obj-1-r1",
          objective_id: "obj-1",
          round: 1,
          candidate_id: "cand-1",
          statement: "Initial round",
          status: "opened",
          opened_at: new Date().toISOString(),
          actor: "mind-1",
        },
      ],
      mind: {
        actor: "mind-1",
      },
    };

    const assessment = transitionCompletenessCriticSignOff(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("critic_to_next_round");
    expect(assessment.roundNumber).toBe(2);
    expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
    expect(assessment.nextRecommendedCommand).toContain("--round 2");
    expect(assessment.nextRecommendedCommand).toContain("--chain-from /tmp/capsules/mind-gen-1");
  });

  test("transitionCompletenessCriticSignOff: findings review with exhausted budget transitions to discovery", () => {
    const state: Record<string, unknown> = {
      completion_review: {
        status: "findings",
        summary: "Unresolved issues.",
      },
      budget: {
        max_rounds_per_objective: 2,
      },
      rounds: [
        {
          round_id: "round-obj-1-r2",
          objective_id: "obj-1",
          round: 2,
          candidate_id: "cand-1",
          statement: "Round 2",
          status: "opened",
          opened_at: new Date().toISOString(),
          actor: "mind-1",
        },
      ],
      mind: {
        actor: "mind-1",
      },
    };

    const assessment = transitionCompletenessCriticSignOff(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("critic_signed_off");
    expect(assessment.transition).toBe("critic_to_discovery");
    expect(assessment.nextRecommendedCommand).toContain("mind:wake");
  });

  test("transitionPulseCloseToWake: transitions closed pulse without process termination", () => {
    const assessment = transitionPulseCloseToWake(
      "/tmp/capsules/mind-gen-1",
      "pulse-42",
      "advanced",
    );

    expect(assessment.canRecycle).toBe(true);
    expect(assessment.phase).toBe("pulse_closed");
    expect(assessment.transition).toBe("pulse_to_wake");
    expect(assessment.nextRecommendedCommand).toBe("bun harness.ts mind:wake --run /tmp/capsules/mind-gen-1");
    expect(assessment.infiniteCadence).toBe(true);
  });

  test("enforceInfiniteMindCadence: strictly enforces perpetual cadence", () => {
    const normal = enforceInfiniteMindCadence({
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
      isTerminal: false,
    });
    expect(normal.cadence).toBe("infinite_autonomous");
    expect(normal.allowed).toBe(true);
    expect(normal.nextInstruction).toBe("bun harness.ts mind:wake --run /tmp/capsules/mind-gen-1");
    expect(normal.message).toContain("Infinite autonomous mind cadence active");

    const terminal = enforceInfiniteMindCadence({
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
      isTerminal: true,
    });
    expect(terminal.cadence).toBe("infinite_autonomous");
    expect(terminal.allowed).toBe(true);
    expect(terminal.message).toContain("Terminal outcome recorded");
  });

  test("planAutonomousRoundRecycle and formatRecycleBrief render clean output", () => {
    const state: Record<string, unknown> = {
      mind: {
        actor: "mind-1",
        candidates: [
          {
            id: "cand-new-1",
            kind: "defect",
            statement: "Automated test defect",
            write_scope: ["src/"],
            status: "admitted",
          },
        ],
      },
    };

    const plan = planAutonomousRoundRecycle(state, {
      runRoot: "/tmp/capsules/mind-gen-1",
      actor: "mind-1",
    });

    expect(plan.transition).toBe("candidate_to_planning");
    expect(plan.candidateId).toBe("cand-new-1");
    expect(plan.planCommands.length).toBeGreaterThan(0);
    expect(plan.markdown).toContain("Autonomous Mind Recycler");
    expect(plan.markdown).toContain("infinite autonomous loop active");
    expect(plan.markdown.split("\n").length).toBeLessThanOrEqual(25);
  });
});

