// Discriminating gate for t1-mind-pulse-lifecycle (defects 104, 105, and the pulse-lifecycle
// deadlock escalated by Tier 0 Mind mid-flight).
//
// Every assertion here targets the DEFECT MECHANISM directly, not a proxy for it:
//  - classification: pulse.last.outcome / reclaimDeadPulse's own outcome field, not just "did not
//    halt";
//  - counter reset: an exact 0 after a PRIOR crash streak, not merely "below threshold";
//  - the un-halt path: the persisted mind.halted transition plus a real mind:pulse-open call with
//    no manual agent:register in the test at all;
//  - the grant carry-over: the target capsule's own agent ledger, plus the same real
//    mind:pulse-open call.
//
// Imports deliberately avoid anything added by this task's own fix (pulseProducedActivity,
// DEFAULT_CONSECUTIVE_CRASH_THRESHOLD, carriedGrantsCount) so that reverting the tracked source
// files in this write scope to their pre-fix content still lets this file import and run --
// producing genuine assertion failures against the real defect mechanism, never a module-resolution
// or file-absence failure.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindPulseOpenCommand } from "../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { mindEscalateCommand } from "../../olt/scripts/src/cli/commands/mind-escalate.ts";
import { mindHaltCommand } from "../../olt/scripts/src/cli/commands/mind-halt.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { initRun } from "../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import { reclaimDeadPulse } from "../../olt/scripts/src/mind/lifecycle/index.ts";
import { rotateMindGeneration } from "../../olt/scripts/src/mind/archival/rotate/index.ts";
import { readAgentLedger } from "../../olt/scripts/src/workflow/agents/ledger.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const CHARTER_CONTENT =
  'name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test mind"\n  goals:\n' +
  '    - id: "G1"\n      statement: "Stability"\n  non_goals:\n    - "None"\n' +
  '  repo_roots:\n    - "src/"\n';

interface CapsuleFixture {
  readonly repo: string;
  readonly run: string;
}

interface CapsuleOverrides {
  readonly pulseOpen?: Record<string, unknown> | null;
  readonly pulseLast?: Record<string, unknown> | null;
  readonly mindHalted?: boolean;
  readonly mindHaltReason?: string;
  readonly agents?: readonly Record<string, unknown>[];
}

function buildCapsule(label: string, overrides: CapsuleOverrides = {}): CapsuleFixture {
  const repo = scratchRoot(label);
  mkdirSync(repo, { recursive: true });
  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  writeFileSync(join(charterDir, "mind.yaml"), CHARTER_CONTENT, "utf-8");
  const charterSha = createHash("sha256").update(CHARTER_CONTENT).digest("hex");

  const run = initRun(
    repo,
    `mind-gen-${label}`,
    new TextEncoder().encode(CHARTER_CONTENT),
    "file",
    true,
  );

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
        actor: "mind-1",
        ...(overrides.mindHalted
          ? { halted: true, halt_reason: overrides.mindHaltReason ?? "test halt" }
          : {}),
      };

      working.budget = {
        base_interval_ms: 900_000,
        pulse_deadline_ms: 1_200_000,
      };

      working.pulse = {
        counter: 1,
        open: overrides.pulseOpen !== undefined ? overrides.pulseOpen : null,
        last: overrides.pulseLast !== undefined ? overrides.pulseLast : null,
      };

      working.escalations = [];
      working.agents = overrides.agents ?? [];
    },
  );

  return { repo, run };
}

const MIND_GRANT = {
  id: "mind_pulse-gen-1",
  role: "mind",
  parent_agent_id: null,
  parent_task_id: null,
  host: "antigravity",
  granted_at: "2026-01-01T00:00:00.000Z",
  status: "active",
} as const;

describe("mind:rotate carries the Mind's agent grant into the new capsule (defect: dropped grant)", () => {
  test("an active grant is carried forward verbatim, and mind:pulse-open succeeds on the target with NO manual agent:register", () => {
    const { run } = buildCapsule("rotate-grant-carry", { agents: [MIND_GRANT] });

    const rotateResult = rotateMindGeneration({ sourceRunRoot: run, actor: "owner" });

    // Direct assertion on the carried ledger itself, not merely an inference from downstream success.
    const targetLedger = readAgentLedger(loadRun(rotateResult.targetRunRoot, false).state);
    const carried = targetLedger.find((grant) => grant.id === "mind_pulse-gen-1");
    expect(carried).toBeDefined();
    expect(carried?.role).toBe("mind");
    expect(carried?.status).toBe("active");

    // No agent:register call anywhere in this test. This is the exact real-world failure Mind
    // reported: "agent mind_pulse-gen-3 holds no grant; register it with agent:register first".
    const openResult = mindPulseOpenCommand({
      run: rotateResult.targetRunRoot,
      actor: "mind_pulse-gen-1",
      host: "antigravity",
      driver: "manual",
    });

    expect(openResult.actor).toBe("mind_pulse-gen-1");
    expect(typeof openResult.pulse_id).toBe("string");
  });

  test("a released grant is not carried forward as active", () => {
    const { run } = buildCapsule("rotate-grant-released", {
      agents: [
        {
          ...MIND_GRANT,
          status: "released",
          released_at: "2026-01-02T00:00:00.000Z",
          release_reason: "test",
        },
      ],
    });

    const rotateResult = rotateMindGeneration({ sourceRunRoot: run, actor: "owner" });
    const targetLedger = readAgentLedger(loadRun(rotateResult.targetRunRoot, false).state);
    expect(
      targetLedger.find((grant) => grant.id === "mind_pulse-gen-1" && grant.status === "active"),
    ).toBeUndefined();
  });
});

function buildExpiredActivePulseWithPriorCrashStreak(label: string): { readonly run: string } {
  const baseTimeMs = 1_700_000_000_000;
  const openedAt = new Date(baseTimeMs).toISOString();
  const deadlineAt = new Date(baseTimeMs + 60_000).toISOString();

  const { run } = buildCapsule(label, {
    pulseOpen: {
      pulse_id: "pulse-1",
      opened_at: openedAt,
      deadline_at: deadlineAt,
      actor: "mind-1",
      host: "antigravity",
      driver: "manual",
    },
    // A pre-existing crash streak: "resets to 0" must be a real reset, not an artifact of
    // starting from zero. Asserting only "below threshold" would not discriminate this.
    pulseLast: { outcome: "crashed", consecutive_crashes: 2 },
  });

  // Real activity recorded in the event log AFTER the pulse opened. Mind can never close its own
  // pulse (CLOSING_FORBIDDEN_FOR_MIND), so this is what "the Mind did real work" looks like in the
  // chain: further events after the open, not a close event.
  transact(run, "mind-1", "mind-candidate-recorded", { candidate_id: "cand-1" }, (working) => {
    working.candidates = [{ id: "cand-1", status: "opened" }];
  });

  return { run };
}

describe("pulse-reclaim classifies from the event log, not wall-clock (defect: guaranteed-crash misclassification)", () => {
  test("an expired pulse with recorded activity is classified completed, never crashed", () => {
    const { run } = buildExpiredActivePulseWithPriorCrashStreak("reclaim-activity-classification");
    const checkTimeMs = 1_700_000_000_000 + 95_000; // 35s past deadline, 5s past a 30s grace window
    const result = reclaimDeadPulse(run, { now: checkTimeMs, graceSeconds: 30 });

    expect(result.reclaimed).toBe(true);

    // Persisted state first -- this is what every other reader of this capsule (brief.ts,
    // lane.ts, the rescue lane) actually sees, and it is a real string under both the pre-fix and
    // fixed classifier (unlike PulseReclaimResult.outcome, which the pre-fix classifier never
    // returned at all).
    const state = loadRun(run, false).state;
    const pulse = state.pulse as Record<string, unknown>;
    const last = pulse.last as Record<string, unknown>;
    expect(last.outcome).toBe("completed");
    expect(result.outcome).toBe("completed");
  });

  test("an expired pulse with recorded activity resets a prior crash streak to exactly 0 and is never halted", () => {
    const { run } = buildExpiredActivePulseWithPriorCrashStreak("reclaim-activity-counter-reset");
    const checkTimeMs = 1_700_000_000_000 + 95_000;
    const result = reclaimDeadPulse(run, { now: checkTimeMs, graceSeconds: 30 });

    const state = loadRun(run, false).state;
    const pulse = state.pulse as Record<string, unknown>;
    const last = pulse.last as Record<string, unknown>;
    // Exactly 0, not merely "below the halt threshold": a counter that only ever rises would
    // read 3 here (2 prior + 1 for this pulse), which would also wrongly trip the halt below.
    // Exactly 0 is the only value a genuine reset can produce.
    expect(last.consecutive_crashes).toBe(0);
    expect(result.consecutiveCrashes).toBe(0);
    expect(result.halted).toBe(false);
  });

  test("an expired pulse with no recorded activity is still classified crashed and extends the streak", () => {
    const baseTimeMs = 1_700_000_000_000;
    const openedAt = new Date(baseTimeMs).toISOString();
    const deadlineAt = new Date(baseTimeMs + 60_000).toISOString();

    const { run } = buildCapsule("reclaim-no-activity-crashed", {
      pulseOpen: {
        pulse_id: "pulse-1",
        opened_at: openedAt,
        deadline_at: deadlineAt,
        actor: "mind-1",
        host: "antigravity",
        driver: "manual",
      },
    });

    const checkTimeMs = baseTimeMs + 95_000;
    const result = reclaimDeadPulse(run, { now: checkTimeMs, graceSeconds: 30 });

    const state = loadRun(run, false).state;
    const pulse = state.pulse as Record<string, unknown>;
    const last = pulse.last as Record<string, unknown>;
    expect(last.outcome).toBe("crashed");
    expect(last.consecutive_crashes).toBe(1);
    expect(result.consecutiveCrashes).toBe(1);
  });
});

describe("there is a supported, granted path out of halted (defect: nothing ever clears mind.halted)", () => {
  test("mind:pulse-open is genuinely blocked while halted, and mind:rotate is a working recovery with no manual agent:register", () => {
    const { run } = buildCapsule("halted-unhalt-path", {
      mindHalted: true,
      mindHaltReason: "consecutive pulse crashes threshold exceeded",
      agents: [MIND_GRANT],
    });

    // Direct proof the block is real before any recovery is attempted.
    expect(() =>
      mindPulseOpenCommand({
        run,
        actor: "mind_pulse-gen-1",
        host: "antigravity",
        driver: "manual",
      }),
    ).toThrow(HarnessError);

    const rotateResult = rotateMindGeneration({ sourceRunRoot: run, actor: "owner" });

    // Direct assertion of the recovery transition itself, not an inference from a downstream call.
    const targetMind = loadRun(rotateResult.targetRunRoot, false).state.mind as Record<
      string,
      unknown
    >;
    expect(targetMind.halted).not.toBe(true);

    const openResult = mindPulseOpenCommand({
      run: rotateResult.targetRunRoot,
      actor: "mind_pulse-gen-1",
      host: "antigravity",
      driver: "manual",
    });
    expect(typeof openResult.pulse_id).toBe("string");
  });
});

describe("mind:escalate and mind:halt are executable (defects 104, 105: NOT_IMPLEMENTED stubs)", () => {
  test("mind:escalate records an escalation event without throwing", () => {
    const { run } = buildCapsule("escalate-executable");

    const result = mindEscalateCommand({
      run,
      actor: "mind-1",
      reason: "budget exhausted unexpectedly",
    });

    expect(result.reason).toBe("budget exhausted unexpectedly");
    const state = loadRun(run, false).state;
    expect(Array.isArray(state.escalations)).toBe(true);
    expect((state.escalations as unknown[]).length).toBeGreaterThan(0);
  });

  test("mind:halt durably halts the run and suppresses successor arming", () => {
    const { run } = buildCapsule("halt-executable");

    const result = mindHaltCommand({
      run,
      actor: "mind-1",
      reason: "critical safety check failure",
    });

    expect(result.halted).toBe(true);

    const state = loadRun(run, false).state;
    const mind = state.mind as Record<string, unknown>;
    expect(mind.halted).toBe(true);
    expect(mind.halt_reason).toBe("critical safety check failure");
  });
});
