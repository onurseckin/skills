import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { readLastPulse } from "../../../olt/scripts/src/mind/last-pulse.ts";
import { reclaimDeadPulse } from "../../../olt/scripts/src/mind/pulse-reclaim.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { Clock } from "../../../olt/scripts/src/workflow/types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  roots.length = 0;
});

interface CapsuleFixture {
  readonly repo: string;
  readonly run: string;
}

function setupTestCapsule(
  name: string,
  overrides: {
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseLast?: Record<string, unknown> | null;
    readonly mindHalted?: boolean;
    readonly mindHaltReason?: string;
  } = {},
): CapsuleFixture {
  const repo = mkdtempSync(
    join(tmpdir(), `pulse-reclaim-test-${name}-${Math.random().toString(36).slice(2)}-`),
  );
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application"\n  goals:\n    - id: "G1"\n      statement: "Stability"\n  non_goals:\n    - "None"\n  repo_roots:\n    - "src/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");
  const charterSha = createHash("sha256").update(charterContent).digest("hex");

  const run = initRun(
    repo,
    `mind-gen-${name}`,
    new TextEncoder().encode(charterContent),
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
          ? {
              halted: true,
              halt_reason: overrides.mindHaltReason ?? "test halt",
            }
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
    },
  );

  return { repo, run };
}

describe("reclaimDeadPulse — Dead Pulse Reclamation", () => {
  describe("Grace Period Handling", () => {
    test("does not reclaim pulse when deadline is passed but still within grace period", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 60_000).toISOString(); // deadline at +60s
      const checkTimeMs = baseTimeMs + 75_000; // +75s (15s past deadline, but within 30s grace)

      const { run } = setupTestCapsule("grace-within", {
        pulseOpen: {
          pulse_id: "pulse-1",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
          host: "antigravity",
          driver: "manual",
        },
      });

      const result = reclaimDeadPulse(run, {
        now: checkTimeMs,
        graceSeconds: 30, // 30s grace -> effective deadline is +90s
      });

      expect(result.reclaimed).toBe(false);
      expect(result.pulseId).toBe("pulse-1");
      expect(result.reason).toContain("still within deadline and grace period");

      // Verify pulse remains open in state
      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      expect(pulse.open).toBeDefined();
      expect((pulse.open as Record<string, unknown>).pulse_id).toBe("pulse-1");
    });

    test("reclaims pulse when deadline plus grace period has elapsed", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 60_000).toISOString(); // deadline at +60s
      const checkTimeMs = baseTimeMs + 95_000; // +95s (past +60s deadline + 30s grace)

      const { run } = setupTestCapsule("grace-exceeded", {
        pulseOpen: {
          pulse_id: "pulse-1",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
          host: "antigravity",
          driver: "manual",
        },
      });

      const result = reclaimDeadPulse(run, {
        now: checkTimeMs,
        graceSeconds: 30,
      });

      expect(result.reclaimed).toBe(true);
      expect(result.pulseId).toBe("pulse-1");
      expect(result.consecutiveCrashes).toBe(1);
      expect(result.halted).toBe(false);
      expect(result.evidence).toBe("no close within deadline");
      expect(result.deadlinePassedByMs).toBe(35_000); // 95s - 60s

      // Verify pulse open state is cleared and last is set
      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      expect(pulse.open).toBeNull();
      const last = pulse.last as Record<string, unknown>;
      expect(last.pulse_id).toBe("pulse-1");
      expect(last.outcome).toBe("crashed");
      expect(last.consecutive_crashes).toBe(1);
      expect(last.arm_mechanism).toBe("crash-recovery");
      expect(last.armed_interval_ms).toBe(900_000);
    });

    test("throws TypeError for invalid graceSeconds values", () => {
      const { run } = setupTestCapsule("grace-invalid");

      expect(() => {
        reclaimDeadPulse(run, { graceSeconds: -5 });
      }).toThrow("grace_seconds must be an integer from 0 to 86400");

      expect(() => {
        reclaimDeadPulse(run, { graceSeconds: 3.14 });
      }).toThrow("grace_seconds must be an integer from 0 to 86400");

      expect(() => {
        reclaimDeadPulse(run, { graceSeconds: 100_000 });
      }).toThrow("grace_seconds must be an integer from 0 to 86400");
    });
  });

  describe("Pulse ID Verification", () => {
    test("succeeds when expected pulseId matches open pulse", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 60_000).toISOString();

      const { run } = setupTestCapsule("id-match", {
        pulseOpen: {
          pulse_id: "pulse-42",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
      });

      const result = reclaimDeadPulse(run, {
        now: baseTimeMs + 100_000,
        pulseId: "pulse-42",
      });

      expect(result.reclaimed).toBe(true);
      expect(result.pulseId).toBe("pulse-42");
    });

    test("refuses reclaim and throws INVALID_ARGUMENT when expected pulseId does not match", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 60_000).toISOString();

      const { run } = setupTestCapsule("id-mismatch", {
        pulseOpen: {
          pulse_id: "pulse-42",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
      });

      expect(() => {
        reclaimDeadPulse(run, {
          now: baseTimeMs + 100_000,
          pulseId: "pulse-99",
        });
      }).toThrow(HarnessError);

      try {
        reclaimDeadPulse(run, {
          now: baseTimeMs + 100_000,
          pulseId: "pulse-99",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_ARGUMENT");
        expect(harnessErr.message).toContain(
          "pulse id 'pulse-99' does not match open pulse id 'pulse-42'",
        );
      }

      // Verify state was not modified
      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      expect((pulse.open as Record<string, unknown>).pulse_id).toBe("pulse-42");
    });

    test("refuses and throws INVALID_STATE when target pulseId specified but no pulse is open", () => {
      const { run } = setupTestCapsule("id-no-open", {
        pulseOpen: null,
      });

      expect(() => {
        reclaimDeadPulse(run, {
          expectedPulseId: "pulse-1",
        });
      }).toThrow(HarnessError);

      try {
        reclaimDeadPulse(run, {
          expectedPulseId: "pulse-1",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain("no active pulse is currently open to reclaim");
      }
    });

    test("returns non-reclaimed result cleanly when no pulse is open and no pulseId was requested", () => {
      const { run } = setupTestCapsule("no-open-quiet", {
        pulseOpen: null,
      });

      const result = reclaimDeadPulse(run);
      expect(result.reclaimed).toBe(false);
      expect(result.reason).toBe("no open pulse");
    });
  });

  describe("Injected Clocks and State Transitions", () => {
    test("tracks deadline transitions through an injected Clock object", () => {
      let simulatedTimeMs = 1_700_000_000_000;
      const injectedClock: Clock = {
        now: () => new Date(simulatedTimeMs),
      };

      const openedAt = new Date(simulatedTimeMs).toISOString();
      const deadlineAt = new Date(simulatedTimeMs + 60_000).toISOString();

      const { run } = setupTestCapsule("clock-injection", {
        pulseOpen: {
          pulse_id: "pulse-10",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
      });

      // 1. Before deadline: not reclaimed
      simulatedTimeMs += 30_000; // +30s
      let result = reclaimDeadPulse(run, { clock: injectedClock });
      expect(result.reclaimed).toBe(false);

      // 2. Exactly at deadline: not reclaimed
      simulatedTimeMs = 1_700_000_000_000 + 60_000;
      result = reclaimDeadPulse(run, { clock: injectedClock });
      expect(result.reclaimed).toBe(false);

      // 3. 1 millisecond past deadline: reclaimed!
      simulatedTimeMs = 1_700_000_000_000 + 60_001;
      result = reclaimDeadPulse(run, { clock: injectedClock });
      expect(result.reclaimed).toBe(true);
      expect(result.pulseId).toBe("pulse-10");
      expect(result.consecutiveCrashes).toBe(1);
    });
  });

  describe("3-Crash HALT Ladder (Poisoned Capsule)", () => {
    test("first crash transitions to crashed with 1 consecutive crash and arms successor", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 10_000).toISOString();

      const { run } = setupTestCapsule("crash-ladder-1", {
        pulseOpen: {
          pulse_id: "pulse-1",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
        pulseLast: {
          pulse_id: "pulse-0",
          closed_at: new Date(baseTimeMs - 100_000).toISOString(),
          outcome: "quiescent",
          value: 0,
          consecutive_crashes: 0,
        },
      });

      const result = reclaimDeadPulse(run, { now: baseTimeMs + 20_000 });

      expect(result.reclaimed).toBe(true);
      expect(result.consecutiveCrashes).toBe(1);
      expect(result.halted).toBe(false);
      expect(result.haltReason).toBeUndefined();

      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("crashed");
      expect(last.consecutive_crashes).toBe(1);
      expect(last.arm_mechanism).toBe("crash-recovery");
      expect(last.armed_interval_ms).toBe(900_000);

      const mind = state.mind as Record<string, unknown>;
      expect(mind.halted).toBeUndefined();

      const lastPulseDisk = readLastPulse(run);
      expect(lastPulseDisk).not.toBeNull();
      expect(lastPulseDisk?.outcome).toBe("crashed");
      expect(lastPulseDisk?.pulse_id).toBe("pulse-1");
    });

    test("second crash increments consecutive_crashes to 2 and does not halt", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 10_000).toISOString();

      const { run } = setupTestCapsule("crash-ladder-2", {
        pulseOpen: {
          pulse_id: "pulse-2",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
        pulseLast: {
          pulse_id: "pulse-1",
          closed_at: new Date(baseTimeMs - 50_000).toISOString(),
          outcome: "crashed",
          value: 0,
          consecutive_crashes: 1,
        },
      });

      const result = reclaimDeadPulse(run, { now: baseTimeMs + 20_000 });

      expect(result.reclaimed).toBe(true);
      expect(result.consecutiveCrashes).toBe(2);
      expect(result.halted).toBe(false);

      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("crashed");
      expect(last.consecutive_crashes).toBe(2);

      const mind = state.mind as Record<string, unknown>;
      expect(mind.halted).toBeUndefined();
    });

    test("third consecutive crash triggers HALT, escalates, and does not arm successor", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 10_000).toISOString();

      const { run } = setupTestCapsule("crash-ladder-3", {
        pulseOpen: {
          pulse_id: "pulse-3",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
        pulseLast: {
          pulse_id: "pulse-2",
          closed_at: new Date(baseTimeMs - 50_000).toISOString(),
          outcome: "crashed",
          value: 0,
          consecutive_crashes: 2,
        },
      });

      const result = reclaimDeadPulse(run, { now: baseTimeMs + 20_000 });

      expect(result.reclaimed).toBe(true);
      expect(result.consecutiveCrashes).toBe(3);
      expect(result.halted).toBe(true);
      expect(result.haltReason).toBe("consecutive pulse crashes threshold exceeded");

      // Verify state reflects HALT per PLAN.md §9.2 and PHASE-2.md §3.5
      const state = loadRun(run, false).state;
      const pulse = state.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("crashed");
      expect(last.consecutive_crashes).toBe(3);
      expect(last.armed_interval_ms).toBeNull(); // HALT does NOT arm!
      expect(last.arm_mechanism).toBeNull();
      expect(last.terminal_reason).toBe("consecutive pulse crashes threshold exceeded");

      const mind = state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toBe("consecutive pulse crashes threshold exceeded");

      // Verify escalations array contains the crash escalation
      const escalations = state.escalations as readonly Record<string, unknown>[];
      expect(escalations.length).toBeGreaterThan(0);
      const crashEscalation = escalations.find((e) => e.reason === "consecutive_pulse_crashes");
      expect(crashEscalation).toBeDefined();
      expect(crashEscalation?.detail).toContain("consecutive pulse crashes threshold exceeded");

      // Verify last_pulse.json on disk reflects crash without next wake
      const lastPulseDisk = readLastPulse(run);
      expect(lastPulseDisk?.outcome).toBe("crashed");
      expect(lastPulseDisk?.next_wake_at).toBeNull();
    });

    test("supports custom deterministicCrashThreshold", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 10_000).toISOString();

      const { run } = setupTestCapsule("custom-threshold", {
        pulseOpen: {
          pulse_id: "pulse-2",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-1",
        },
        pulseLast: {
          pulse_id: "pulse-1",
          closed_at: new Date(baseTimeMs - 50_000).toISOString(),
          outcome: "crashed",
          value: 0,
          consecutive_crashes: 1,
        },
      });

      const result = reclaimDeadPulse(run, {
        now: baseTimeMs + 20_000,
        deterministicCrashThreshold: 2, // Halt at 2 crashes instead of 3
      });

      expect(result.reclaimed).toBe(true);
      expect(result.consecutiveCrashes).toBe(2);
      expect(result.halted).toBe(true);
      expect(result.haltReason).toBe("consecutive pulse crashes threshold exceeded");
    });
  });

  describe("Event Log and Evidence Recording", () => {
    test("records mind-pulse-reclaimed event with authoritative evidence", () => {
      const baseTimeMs = 1_700_000_000_000;
      const openedAt = new Date(baseTimeMs).toISOString();
      const deadlineAt = new Date(baseTimeMs + 10_000).toISOString();

      const { run } = setupTestCapsule("evidence-record", {
        pulseOpen: {
          pulse_id: "pulse-7",
          opened_at: openedAt,
          deadline_at: deadlineAt,
          actor: "mind-worker",
        },
      });

      reclaimDeadPulse(run, {
        now: baseTimeMs + 25_000,
        actor: "mind-supervisor",
        graceSeconds: 5,
      });

      const loaded = loadRun(run, false);
      const reclaimEvent = loaded.events.find((e) => e.kind === "mind-pulse-reclaimed");
      expect(reclaimEvent).toBeDefined();
      expect(reclaimEvent?.actor).toBe("mind-supervisor");

      const payload = reclaimEvent?.payload as Record<string, unknown>;
      expect(payload.pulse_id).toBe("pulse-7");
      expect(payload.deadline_passed_by_ms).toBe(15_000);
      expect(payload.consecutive_crash_count).toBe(1);
      expect(payload.evidence).toBe("no close within deadline");
      expect(payload.grace_seconds).toBe(5);
      expect(payload.halted).toBe(false);
    });
  });
});
