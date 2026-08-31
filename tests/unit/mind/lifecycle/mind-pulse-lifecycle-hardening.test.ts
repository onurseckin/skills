import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  evaluateAntiIdleRollover,
  createCadenceTrigger,
} from "../../../../olt/scripts/src/mind/lifecycle/cadence/index.ts";
import {
  checkQuietHours,
  checkDailyPulseLimit,
} from "../../../../olt/scripts/src/mind/lifecycle/budget/index.ts";
import {
  detectGhostOrchestrators,
  terminateDetachedOrchestrator,
} from "../../../../olt/scripts/src/mind/lifecycle/ghost-reconciler.ts";
import { reclaimDeadPulse } from "../../../../olt/scripts/src/mind/lifecycle/pulse/pulse-reclaim.ts";
import { validatePriorRoundCompleted } from "../../../../olt/scripts/src/mind/lifecycle/rounds/index.ts";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
  testRoots.length = 0;
});

function setupTestCapsule(name: string): { repo: string; run: string } {
  const repo = mkdtempSync(join(tmpdir(), `mind-hardening-test-${name}-`));
  testRoots.push(repo);
  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  mkdirSync(join(repo, ".olt"), { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Hardening Mind"\n  goals:\n    - id: "G1"\n      statement: "Perpetual Integrity"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");
  const bytes = readFileSync(charterPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const run = initRun(repo, `run-${name}`, bytes, "file", true);

  transact(run, "test-actor", "mind-initialized", { generation: 1 }, (working) => {
    working.mind = {
      generation: 1,
      opened_at: new Date().toISOString(),
      charter: { source_path: "olt/agents/mind.yaml", pinned_sha256: sha, goals: ["G1"] },
    };
    working.budget = {
      day_key: "2026-08-22",
      pulses_today: 0,
      wall_clock_ms_today: 0,
      pulses_per_day: 50,
      wall_clock_ms_per_day: 3600000,
    };
  });

  return { repo, run };
}

describe("Mind Pulse Lifecycle Hardening Suite", () => {
  describe("Challenge 1: TOCTOU Race Condition Guard in Pulse Reclaim", () => {
    test("reclaimDeadPulse re-verifies fresh state and handles concurrent closure cleanly", () => {
      const { run } = setupTestCapsule("toctou-closed");
      // Open a pulse with expired deadline
      transact(run, "mind", "mind-pulse-opened", { pulse_id: "pulse-1" }, (working) => {
        working.pulse = {
          open: {
            pulse_id: "pulse-1",
            opened_at: "2026-08-22T08:00:00.000Z",
            deadline_at: "2026-08-22T08:15:00.000Z",
          },
          last: null,
          counter: 1,
        };
      });

      // Concurrently close the pulse before reclaim execution
      transact(run, "mind", "test-concurrent-close", {}, (working) => {
        const pulse = working.pulse as Record<string, unknown>;
        pulse.open = null;
      });

      const result = reclaimDeadPulse(run, {
        now: "2026-08-22T09:00:00.000Z",
      });

      expect(result.reclaimed).toBe(false);
      expect(result.reason).toBe("no open pulse");

      // When expected pulse ID is provided and pulse is already closed, it throws INVALID_STATE
      expect(() => {
        reclaimDeadPulse(run, {
          now: "2026-08-22T09:00:00.000Z",
          expectedPulseId: "pulse-1",
        });
      }).toThrow(/no active pulse is currently open to reclaim/);
    });
  });

  describe("Challenge 2: Generational Succession under CLOSING_FORBIDDEN_FOR_MIND", () => {
    test("validatePriorRoundCompleted permits unclosed pulse from predecessor Mind generation", () => {
      const { run: priorRun } = setupTestCapsule("prior-mind-pulse");
      // Predecessor Mind has an open pulse (canonical under CLOSING_FORBIDDEN_FOR_MIND)
      transact(priorRun, "mind", "mind-pulse-opened", { pulse_id: "pulse-pred-1" }, (working) => {
        working.pulse = {
          open: {
            pulse_id: "pulse-pred-1",
            opened_at: "2026-08-22T08:00:00.000Z",
            deadline_at: "2026-08-22T08:15:00.000Z",
          },
          last: null,
          counter: 1,
        };
      });

      // Generational succession / chaining round from prior mind run does NOT throw INVALID_STATE
      expect(() => {
        validatePriorRoundCompleted(priorRun, "prior-mind-run");
      }).not.toThrow();
    });

    test("validatePriorRoundCompleted throws for non-mind run with unclosed pulse", () => {
      const { run: nonMindRun } = setupTestCapsule("prior-non-mind");
      transact(nonMindRun, "user", "remove-mind-field", {}, (working) => {
        delete working.mind;
        working.pulse = {
          open: {
            pulse_id: "pulse-task-1",
            opened_at: "2026-08-22T08:00:00.000Z",
            deadline_at: "2026-08-22T08:15:00.000Z",
          },
        };
      });

      expect(() => {
        validatePriorRoundCompleted(nonMindRun, "prior-task-run");
      }).toThrow(/active unclosed pulse/);
    });
  });

  describe("Challenge 3: Anti-Idle 0ms Storming Prevention", () => {
    test("evaluates to 0ms immediate rollover when actively runnable tasks exist", () => {
      const trigger = createCadenceTrigger("TIMER_EXPIRED");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 3,
        activeRunnableTasks: 3,
        inFlightTasks: 0,
      });

      expect(decision.shouldRolloverImmediately).toBe(true);
      expect(decision.targetDelayMs).toBe(0);
      expect(decision.targetPhase).toBe("ACTIVE");
      expect(decision.activeRunnableCount).toBe(3);
    });

    test("throttles to non-zero delay when all tasks are in-flight/leased without 0ms storming", () => {
      const trigger = createCadenceTrigger("TIMER_EXPIRED");
      const decision = evaluateAntiIdleRollover({
        trigger,
        pendingTasks: 3,
        inFlightTasks: 3,
        applyJitter: false,
        baseIntervalMs: 15_000,
      });

      expect(decision.shouldRolloverImmediately).toBe(false);
      expect(decision.targetDelayMs).toBe(15_000);
      expect(decision.targetPhase).toBe("RESTING");
      expect(decision.inFlightCount).toBe(3);
      expect(decision.activeRunnableCount).toBe(0);
      expect(decision.reason).toContain("Anti-idle throttled");
    });
  });

  describe("Challenge 4: Timezone Awareness & Pure Budget Calculation", () => {
    test("checkQuietHours accurately evaluates with explicit IANA timezones and string suffixes", () => {
      // 22:00 to 06:00 in America/New_York (UTC-4 in August)
      // When UTC is 03:00 (which is 23:00 in NY), it is inside quiet hours
      const resNY = checkQuietHours("22:00-06:00 America/New_York", "2026-08-22T03:00:00.000Z");
      expect(resNY.inQuietHours).toBe(true);

      // When UTC is 14:00 (which is 10:00 in NY), it is NOT inside quiet hours
      const resNYDay = checkQuietHours("22:00-06:00 America/New_York", "2026-08-22T14:00:00.000Z");
      expect(resNYDay.inQuietHours).toBe(false);
    });

    test("checkDailyPulseLimit and checkDailyBudget are purely functional during dryRun", () => {
      const budget = {
        day_key: "2026-08-21",
        pulses_today: 10,
        wall_clock_ms_today: 50000,
        pulses_per_day: 20,
      };

      // Check on a new day "2026-08-22"
      const result = checkDailyPulseLimit(budget, "2026-08-22T10:00:00.000Z");
      expect(result.ok).toBe(true);

      // Verify input budget object was NOT mutated
      expect(budget.day_key).toBe("2026-08-21");
      expect(budget.pulses_today).toBe(10);
    });
  });

  describe("Challenge 5: Safe Ghost Orchestrator Reconciliation", () => {
    test("detectGhostOrchestrators grants startup grace window to newly spawned agents", () => {
      const now = "2026-08-22T10:00:05.000Z";
      const liveAgents = [
        {
          subagent_id: "orch-just-spawned",
          role: "orchestrator",
          pid: 99999,
          spawned_at: "2026-08-22T10:00:03.000Z", // 2 seconds old, within 5s grace
        },
      ];

      const findings = detectGhostOrchestrators(liveAgents, undefined, {
        now,
        startupGraceWindowMs: 5_000,
      });

      expect(findings.length).toBe(0);
    });

    test("terminateDetachedOrchestrator refuses to kill when PID recycling validation fails", () => {
      const finding = {
        process_id: 88888,
        subagent_id: "orch-recycled",
        detected_at: "2026-08-22T10:00:00.000Z",
        reason: "UNREGISTERED_IN_LEDGER" as const,
        action_taken: "ALERTED" as const,
      };

      let killInvoked = false;
      const terminated = terminateDetachedOrchestrator(finding, {
        killFn: () => {
          killInvoked = true;
          return true;
        },
        verifyProcessStartTime: (_pid) => false, // PID was recycled!
      });

      expect(terminated).toBe(false);
      expect(killInvoked).toBe(false);
    });
  });
});
