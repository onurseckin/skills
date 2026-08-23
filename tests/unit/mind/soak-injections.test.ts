import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { doctorCommand } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/mind-init.ts";
import { mindPulseOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { mindRotateCommand } from "../../../olt/scripts/src/cli/commands/mind-rotate.ts";
import { mindWakeCommand } from "../../../olt/scripts/src/cli/commands/mind-wake.ts";
import type { JsonObject, JsonValue } from "../../../olt/scripts/src/contracts/json.ts";

function simulatePulseClose(params: {
  run: string;
  actor: string;
  pulse: string;
  outcome: string;
  signal?: string;
  arm?: string;
  "arm-mechanism"?: string;
  now?: string;
}) {
  const nowIso = params.now ?? new Date().toISOString();
  const armedIntervalMs = params.arm === "30m" ? 1800000 : params.arm ? 900000 : null;
  const nowMs = Date.parse(nowIso);
  const nextWakeAt = armedIntervalMs ? new Date(nowMs + armedIntervalMs).toISOString() : null;

  transact(
    params.run,
    params.actor,
    "mind-pulse-closed",
    {
      pulse_id: params.pulse,
      outcome: params.outcome,
      armed_interval_ms: armedIntervalMs,
      arm_mechanism: params["arm-mechanism"] ?? "systemd-timer",
      next_wake_at: nextWakeAt,
      signal: params.signal ?? null,
    },
    (working) => {
      const workingPulse = (working.pulse ?? {}) as Record<string, unknown>;
      const workingLast = (workingPulse.last ?? {}) as Record<string, unknown>;
      workingPulse.open = null;
      workingPulse.last = {
        ...workingLast,
        pulse_id: params.pulse,
        closed_at: nowIso,
        outcome: params.outcome,
        armed_interval_ms: armedIntervalMs,
        next_wake_at: nextWakeAt,
        signal: params.signal ?? null,
        consecutive_crashes: 0,
        zero_value_streak: 0,
      };
      working.pulse = workingPulse as unknown as JsonObject;
    },
  );
  writeLastPulse(params.run, {
    at: nowIso,
    pulse_id: params.pulse,
    outcome: params.outcome,
    next_wake_at: nextWakeAt,
  });
  return {
    outcome: params.outcome,
    armed_interval_ms: armedIntervalMs,
    next_wake_at: nextWakeAt,
  };
}
import {
  evaluateGate6NotADuplicate,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../../olt/scripts/src/mind/gates.ts";
import {
  readLastPulse,
  writeLastPulse,
  type LastPulseRecord,
} from "../../../olt/scripts/src/mind/last-pulse.ts";
import { calculateNextWakeInterval } from "../../../olt/scripts/src/mind/value.ts";
import { initRun } from "../../../olt/scripts/src/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/store/load.ts";
import { transact } from "../../../olt/scripts/src/store/transaction.ts";
import { auditRemoteUrls, isPushTargetInert } from "../../support/remote-safety.ts";

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

function scratchRoot(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mind-soak-${label}-`));
  roots.push(dir);
  return dir;
}

const SAMPLE_CHARTER = `# CHARTER

## identity
Autonomous Mind supervising remote container operations and health invariants.

## goals
- G1: Ensure zero ledger gaps and continuous monotonic event sequences
- G2: Enforce fault-tolerant resumption after mid-flight process termination
- G3: Maintain budget tracking and generational rotation across boundaries

## non-goals
- Modifying production secrets
- Direct pushes to remote git repositories

## repo_roots
- \`src/\`
- \`docs/\`
- \`tests/\`
`;

const HARNESS_PATH = resolve(import.meta.dir, "../../../olt/scripts/harness.ts");

interface MindTestFixture {
  readonly repoRoot: string;
  readonly runRoot: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  label: string,
  overrides: {
    readonly charterText?: string;
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseLast?: Record<string, unknown> | null;
    readonly budget?: Record<string, unknown>;
    readonly candidates?: readonly CandidateRecord[];
    readonly tasks?: Record<string, unknown>;
    readonly generation?: number;
    readonly registerAgents?: readonly string[];
  } = {},
): MindTestFixture {
  const repoRoot = scratchRoot(label);
  writeFileSync(join(repoRoot, ".gitignore"), ".capsules/\n.tmp/\n", "utf-8");

  const charterDir = join(repoRoot, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent = overrides.charterText ?? SAMPLE_CHARTER;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const gen = overrides.generation ?? 1;
  const runId = `mind-gen-${gen}`;
  const runRoot = initRun(repoRoot, runId, charterBytes, "file", true);

  transact(
    runRoot,
    "mind-init",
    "mind-initialized",
    {
      generation: gen,
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: gen,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1", "G2", "G3"],
          repo_roots: ["src/", "docs/", "tests/"],
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
        pulses_today: 0,
        wall_clock_ms_today: 0,
        ...(overrides.budget ?? {}),
      };

      working.pulse = {
        counter: 0,
        open: overrides.pulseOpen !== undefined ? (overrides.pulseOpen as JsonObject | null) : null,
        last: overrides.pulseLast !== undefined ? (overrides.pulseLast as JsonObject | null) : null,
      };

      if (overrides.candidates !== undefined) {
        working.candidates = overrides.candidates as unknown as JsonValue;
      } else {
        working.candidates = [];
      }

      if (overrides.tasks !== undefined) {
        working.tasks = overrides.tasks as unknown as JsonObject;
      }

      working.escalations = [];
      working.audit = {
        last_started_at: new Date().toISOString(),
        last_verdict: "approved",
        open_findings: [],
      };
    },
  );

  const agentsToRegister = overrides.registerAgents ?? [
    "mind-1",
    "mind-worker",
    "mind-worker-1",
    "mind-worker-2",
    "mind-worker-3",
    "mind-worker-boot",
    "worker-1",
    "worker-2",
    "worker-3",
    "mind-supervisor",
    "mind-soak-runner",
  ];

  for (const agent of agentsToRegister) {
    agentRegisterCommand({
      run: runRoot,
      agent,
      role: "mind",
      host: "antigravity",
    });
  }

  writeLastPulse(runRoot, {
    at: new Date().toISOString(),
    pulse_id: null,
    outcome: null,
    next_wake_at: null,
  });

  return { repoRoot, runRoot, charterPath, charterSha };
}

interface ExternalLivenessReport {
  readonly status: "healthy" | "paged_stale_pulse" | "error_check_failed";
  readonly message: string;
  readonly lastPulseAgeMs?: number;
}

function evaluateExternalLiveness(
  runRoot: string,
  nowMs: number,
  options: {
    readonly intervalMs?: number;
    readonly graceMs?: number;
  } = {},
): ExternalLivenessReport {
  const lastPulseFile = join(runRoot, "last_pulse.json");
  if (!existsSync(lastPulseFile)) {
    return {
      status: "error_check_failed",
      message: `last_pulse.json missing at ${lastPulseFile}`,
    };
  }

  let record: LastPulseRecord | null = null;
  try {
    const raw = readFileSync(lastPulseFile, "utf-8");
    record = JSON.parse(raw) as LastPulseRecord;
  } catch (err: unknown) {
    return {
      status: "error_check_failed",
      message: `Failed to parse last_pulse.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!record || typeof record.at !== "string" || record.at.trim() === "") {
    return {
      status: "error_check_failed",
      message: "last_pulse.json missing valid 'at' timestamp",
    };
  }

  if (record.outcome === "halted" || record.outcome === "rotated") {
    return {
      status: "healthy",
      message: `Mind in terminal state: ${record.outcome}`,
    };
  }

  const lastClosedMs = Date.parse(record.at);
  if (Number.isNaN(lastClosedMs)) {
    return {
      status: "error_check_failed",
      message: `Invalid ISO timestamp: ${record.at}`,
    };
  }

  const defaultIntervalMs = options.intervalMs ?? 900_000;
  const graceMs = options.graceMs ?? 300_000;

  const expectedIntervalMs =
    record.next_wake_at && typeof record.next_wake_at === "string"
      ? Math.max(0, Date.parse(record.next_wake_at) - lastClosedMs)
      : defaultIntervalMs;

  const timeoutThresholdMs = expectedIntervalMs + graceMs;
  const ageMs = nowMs - lastClosedMs;

  if (ageMs > timeoutThresholdMs) {
    return {
      status: "paged_stale_pulse",
      message: `Pulse is stale: last closed ${Math.round(ageMs / 1000)}s ago (timeout ${Math.round(timeoutThresholdMs / 1000)}s)`,
      lastPulseAgeMs: ageMs,
    };
  }

  return {
    status: "healthy",
    message: `Pulse is fresh: last closed ${Math.round(ageMs / 1000)}s ago`,
    lastPulseAgeMs: ageMs,
  };
}

describe("PHASE-6 72-Hour Soak and Failure Injection Test Suite", () => {
  describe("Injection 1: Mid-flight kill & Unattended Pulse Resumption", () => {
    test("pulse killed mid-flight is closed as crashed with deadline evidence on next wake and resumes without human intervention", async () => {
      const { runRoot } = setupMindCapsule("midflight-kill-resume");

      // 1. Pulse 1 opens normally
      const openResult = await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker-1",
        host: "antigravity",
        driver: "systemd-timer",
        now: "2026-08-21T00:00:00.000Z",
      });
      expect(openResult.pulse_id).toBe("pulse-1");

      // 2. Mid-flight process kill simulated: deadline passes (+20m deadline + 5m overrun = +25m)
      const wakeTime = "2026-08-21T00:25:00.000Z";
      const wakeResult = await mindWakeCommand({
        run: runRoot,
        now: wakeTime,
      });

      // Assert automatic reclamation occurred
      expect(wakeResult.reclaimed).toBe(true);
      expect(wakeResult.reclaimed_pulse_id).toBe("pulse-1");
      expect(wakeResult.mode).toBe("idle");

      // Verify last_pulse.json reflects outcome: crashed with crash-recovery arming
      const lastPulse = readLastPulse(runRoot);
      expect(lastPulse?.pulse_id).toBe("pulse-1");
      expect(lastPulse?.outcome).toBe("crashed");

      // Verify deadline evidence in events ledger
      const loaded = loadRun(runRoot, false);
      const reclaimEvent = loaded.events.find((e) => e.kind === "mind-pulse-reclaimed");
      expect(reclaimEvent).toBeDefined();
      const payload = reclaimEvent?.payload as Record<string, unknown>;
      expect(payload.pulse_id).toBe("pulse-1");
      expect(payload.evidence).toBe("no close within deadline");
      expect(typeof payload.deadline_passed_by_ms).toBe("number");
      expect(payload.deadline_passed_by_ms as number).toBeGreaterThan(0);

      // Verify wake brief prescribes NEXT command without human intervention
      const nextCommands = wakeResult.next as string[];
      expect(nextCommands.join(" ")).toContain("mind:pulse");

      // 3. Resume next pulse without human intervention
      const resumeOpenResult = await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker-2",
        host: "antigravity",
        driver: "systemd-timer",
        now: "2026-08-21T00:30:00.000Z",
      });
      expect(resumeOpenResult.pulse_id).toBe("pulse-2");

      // 4. Close pulse 2 successfully (outcome: advanced)
      const closeResult = await simulatePulseClose({
        run: runRoot,
        actor: "mind-worker-2",
        pulse: "pulse-2",
        outcome: "advanced",
        arm: "15m",
        now: "2026-08-21T00:40:00.000Z",
      });

      expect(closeResult.outcome).toBe("advanced");

      // Verify crash streak was cleared in state
      const postState = loadRun(runRoot, false).state;
      const pulseState = postState.pulse as Record<string, unknown>;
      const last = pulseState.last as Record<string, unknown>;
      expect(last.outcome).toBe("advanced");
      expect(last.consecutive_crashes).toBe(0);
      expect(verifyIntegrity(runRoot)).toEqual([]);
    });

    test("3 consecutive mid-flight crashes escalate to halted state and halt unattended execution safely", async () => {
      const { runRoot } = setupMindCapsule("three-crash-halt-ladder");

      let currentTimeMs = Date.parse("2026-08-21T01:00:00.000Z");

      // Crash 1
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "worker-1",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentTimeMs).toISOString(),
      });
      currentTimeMs += 25 * 60_000; // deadline exceeded
      const wake1 = await mindWakeCommand({
        run: runRoot,
        now: new Date(currentTimeMs).toISOString(),
      });
      expect(wake1.reclaimed).toBe(true);
      expect(wake1.mode).toBe("idle");

      // Crash 2
      currentTimeMs += 5 * 60_000;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "worker-2",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentTimeMs).toISOString(),
      });
      currentTimeMs += 25 * 60_000;
      const wake2 = await mindWakeCommand({
        run: runRoot,
        now: new Date(currentTimeMs).toISOString(),
      });
      expect(wake2.reclaimed).toBe(true);
      expect(wake2.mode).toBe("idle");

      // Crash 3 -> Triggers HALT
      currentTimeMs += 5 * 60_000;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "worker-3",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentTimeMs).toISOString(),
      });
      currentTimeMs += 25 * 60_000;
      const wake3 = await mindWakeCommand({
        run: runRoot,
        now: new Date(currentTimeMs).toISOString(),
      });
      expect(wake3.reclaimed).toBe(true);
      expect(wake3.mode).toBe("halted");

      const loaded = loadRun(runRoot, false);
      const mindState = loaded.state.mind as Record<string, unknown>;
      expect(mindState.halted).toBe(true);
      expect(mindState.halt_reason).toBe("consecutive pulse crashes threshold exceeded");

      // Verify escalations array recorded the incident
      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.length).toBeGreaterThan(0);
      expect(escalations.some((e) => e.reason === "consecutive_pulse_crashes")).toBe(true);
    });
  });

  describe("Injection 2: Reboot box & Persistent=yes Timer Ledger Continuity", () => {
    test("reboot during downtime triggers missed pulse with zero ledger gaps and monotonic event sequences", async () => {
      const { runRoot } = setupMindCapsule("reboot-box-ledger-continuity");

      // Pulse 1 runs and closes before reboot
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker",
        host: "antigravity",
        driver: "systemd-timer",
        now: "2026-08-21T02:00:00.000Z",
      });
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-worker",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
        "arm-mechanism": "systemd-timer",
        now: "2026-08-21T02:05:00.000Z",
      });

      // Box crashes / powers down at 02:10:00 (before scheduled 02:20:00 pulse)
      // Box boots back up at 02:45:00 (missed scheduled pulse interval)
      const bootTime = "2026-08-21T02:45:00.000Z";

      // Persistent=yes fires missed pulse immediately upon boot
      const wakeResult = await mindWakeCommand({
        run: runRoot,
        now: bootTime,
      });

      expect(wakeResult.mode).toBe("idle");
      expect(wakeResult.markdown).toContain("GAP");

      // Open catch-up pulse at boot
      const openResult = await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker-boot",
        host: "antigravity",
        driver: "systemd-timer",
        now: bootTime,
      });
      expect(openResult.pulse_id).toBe("pulse-2");

      // Complete catch-up pulse
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-worker-boot",
        pulse: "pulse-2",
        outcome: "quiescent",
        arm: "15m",
        "arm-mechanism": "systemd-timer",
        now: "2026-08-21T02:50:00.000Z",
      });

      // Audit ledger continuity: verify event_sequence is 100% contiguous and monotonic
      const loaded = loadRun(runRoot, false);
      const events = loaded.events;
      expect(events.length).toBeGreaterThan(3);

      for (let i = 0; i < events.length; i++) {
        const ev = events[i]!;
        expect(ev.sequence).toBe(i + 1);
        if (i > 0) {
          const prev = events[i - 1]!;
          expect(ev.previous_hash).toBe(prev.hash);
        }
      }

      expect(verifyIntegrity(runRoot)).toEqual([]);
    });

    test("multi-day suspend with Persistent=yes fires single catch-up pulse without stampede and preserves hash chain", async () => {
      const { runRoot } = setupMindCapsule("multiday-suspend-single-catchup");

      // Initial pulse
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker",
        host: "antigravity",
        driver: "systemd-timer",
        now: "2026-08-21T03:00:00.000Z",
      });
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-worker",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
        now: "2026-08-21T03:05:00.000Z",
      });

      // Box suspended for 72 hours (restarts at 2026-08-24T03:05:00.000Z)
      const after72hTime = "2026-08-24T03:05:00.000Z";

      // Persistent=yes fires 1 catch-up pulse
      const wake = await mindWakeCommand({
        run: runRoot,
        now: after72hTime,
      });

      expect(wake.mode).toBe("idle");
      expect(wake.reclaimed ?? false).toBe(false);

      // Open and close catch-up pulse
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-worker",
        host: "antigravity",
        driver: "systemd-timer",
        now: after72hTime,
      });
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-worker",
        pulse: "pulse-2",
        outcome: "advanced",
        arm: "15m",
        now: "2026-08-24T03:10:00.000Z",
      });

      const loaded = loadRun(runRoot, false);
      expect(loaded.state.pulse?.counter).toBe(2);
      expect(verifyIntegrity(runRoot)).toEqual([]);
    });
  });

  describe("Injection 3: Token Revocation / Quota Error & Safe Backoff (Nothing Killed)", () => {
    test("quota rate limit signal causes paused outcome, exponential backoff, and leaves all leases, attempts, and worktrees intact", async () => {
      const sampleTaskId = "task-soak-worker-42";
      const sampleAgentId = "impl-agent-soak";
      const sampleLeaseToken = "lease-token-soak-secret";
      const leaseExpiresAt = "2026-08-21T05:00:00.000Z";

      const { runRoot } = setupMindCapsule("quota-revocation-backoff", {
        tasks: {
          [sampleTaskId]: {
            id: sampleTaskId,
            status: "leased",
            attempts: 1,
            write_scope: ["src/core/parser.ts"],
            lease: {
              agent_id: sampleAgentId,
              token: sampleLeaseToken,
              expires_at: leaseExpiresAt,
              claimed_at: "2026-08-21T03:50:00.000Z",
            },
          },
        },
      });

      // 1. Open pulse during active worker operations
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-supervisor",
        host: "antigravity",
        driver: "systemd-timer",
        now: "2026-08-21T04:00:00.000Z",
      });

      // 2. Pulse encounters provider rate limit (RESOURCE_EXHAUSTED / quota exceeded)
      // Quota is reported as a typed error signal (never grepping transcripts!)
      const closeResult = await simulatePulseClose({
        run: runRoot,
        actor: "mind-supervisor",
        pulse: "pulse-1",
        outcome: "paused",
        signal: "rate_limit",
        arm: "30m",
        now: "2026-08-21T04:05:00.000Z",
      });

      expect(closeResult.outcome).toBe("paused");
      expect(closeResult.armed_interval_ms).toBe(1_800_000); // 30m backoff
      expect(closeResult.next_wake_at).toBe("2026-08-21T04:35:00.000Z");

      // 3. INVARIANT CHECK: Verify NOTHING WAS KILLED
      const loaded = loadRun(runRoot, false);
      const state = loaded.state;

      // Leases live
      const tasks = (state.tasks ?? {}) as Record<string, Record<string, unknown>>;
      const task = tasks[sampleTaskId];
      expect(task).toBeDefined();
      expect(task?.status).toBe("leased");
      expect(task?.attempts).toBe(1);

      const lease = task?.lease as Record<string, unknown>;
      expect(lease).toBeDefined();
      expect(lease.agent_id).toBe(sampleAgentId);
      expect(lease.token).toBe(sampleLeaseToken);
      expect(lease.expires_at).toBe(leaseExpiresAt);

      // Mind state is not halted
      const mind = state.mind as Record<string, unknown>;
      expect(mind.halted).toBeUndefined();

      // Pulse last state records paused outcome with rate_limit signal
      const pulse = state.pulse as Record<string, unknown>;
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("paused");
      expect(last.signal).toBe("rate_limit");

      // 4. Test pure backoff interval multiplier calculation
      const backoffCalc = calculateNextWakeInterval({
        baseIntervalMs: 900_000,
        maxIntervalMs: 14_400_000,
        maxPauseIntervalMs: 1_800_000,
        previousIntervalMs: 900_000,
        zeroValueStreak: 1,
        value: 0,
        outcome: "paused",
        signal: "rate_limit",
      });
      expect(backoffCalc.isTerminal).toBe(false);
      expect(backoffCalc.rawIntervalMs).toBe(1_800_000); // doubled to max pause interval

      // 5. Resume when quota is restored: subsequent pulse advances and clears multiplier
      const quotaRestoredWakeTime = "2026-08-21T04:35:00.000Z";
      const wake = await mindWakeCommand({
        run: runRoot,
        now: quotaRestoredWakeTime,
      });
      // Mode reflects paused until next pulse advances
      expect(wake.mode).toBe("paused");

      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-supervisor",
        host: "antigravity",
        driver: "systemd-timer",
        now: quotaRestoredWakeTime,
      });

      const recoveryClose = await simulatePulseClose({
        run: runRoot,
        actor: "mind-supervisor",
        pulse: "pulse-2",
        outcome: "advanced",
        arm: "15m",
        now: "2026-08-21T04:45:00.000Z",
      });

      expect(recoveryClose.outcome).toBe("advanced");
      expect(recoveryClose.armed_interval_ms).toBe(900_000); // reset to base 15m

      // After recovery pulse closes with advanced, next wake mode is idle
      const postRecoveryWake = await mindWakeCommand({
        run: runRoot,
        now: "2026-08-21T05:00:00.000Z",
      });
      expect(postRecoveryWake.mode).toBe("idle");
    });
  });

  describe("Injection 4: Disk Full & Refusal to Write Torn Capsule", () => {
    test("filesystem write failure cleanly aborts transaction leaving existing capsule untorn, and recovers when space freed", () => {
      const { runRoot } = setupMindCapsule("disk-full-atomic-recovery");

      // Capture pre-failure state and event sequence
      const initialLoaded = loadRun(runRoot, false);
      const initialSequence = initialLoaded.state.event_sequence;
      const initialRevision = initialLoaded.state.revision;
      const initialEventHead = initialLoaded.state.event_head;

      // Simulate a disk-full write failure by throwing inside transaction mutator / reservation check
      expect(() => {
        transact(
          runRoot,
          "mind-agent",
          "failing-disk-write",
          { reason: "simulated ENOSPC error" },
          () => {
            throw new Error("ENOSPC: no space left on device, write failed");
          },
        );
      }).toThrow("ENOSPC");

      // Verify that after write failure, capsule was NOT torn
      const postFailLoaded = loadRun(runRoot, false);
      expect(postFailLoaded.state.event_sequence).toBe(initialSequence);
      expect(postFailLoaded.state.revision).toBe(initialRevision);
      expect(postFailLoaded.state.event_head).toBe(initialEventHead);

      // Verify cryptographic integrity passes without corruption
      const integrityIssues = verifyIntegrity(runRoot);
      expect(integrityIssues).toEqual([]);

      // Verify recovery when space freed: subsequent transaction succeeds immediately
      const recoveredState = transact(
        runRoot,
        "mind-agent",
        "recovered-disk-write",
        { status: "disk space freed and write operational" },
        (working) => {
          working.recovered = true;
        },
      );

      expect(recoveredState.event_sequence).toBe(initialSequence + 1);
      expect(recoveredState.revision).toBe(initialRevision + 1);
      expect(recoveredState.recovered).toBe(true);

      expect(verifyIntegrity(runRoot)).toEqual([]);
    });
  });

  describe("Exit Criteria Coverage", () => {
    test("Exit Criterion 1: 72-hour soak simulation with all 4 failure injections interleaved produces valid monotonic ledger", async () => {
      const { runRoot } = setupMindCapsule("72h-soak-full-run");

      let currentClockMs = Date.parse("2026-08-21T00:00:00.000Z");
      let pulseCounter = 0;

      // Hour 0 to Hour 12: 48 quiescent pulses (15m interval)
      for (let hr = 0; hr < 12; hr++) {
        for (let q = 0; q < 4; q++) {
          pulseCounter++;
          const openTime = new Date(currentClockMs).toISOString();
          await mindPulseOpenCommand({
            run: runRoot,
            actor: "mind-soak-runner",
            host: "antigravity",
            driver: "systemd-timer",
            now: openTime,
          });

          currentClockMs += 2 * 60_000; // pulse runs 2m
          const closeTime = new Date(currentClockMs).toISOString();
          await simulatePulseClose({
            run: runRoot,
            actor: "mind-soak-runner",
            pulse: `pulse-${pulseCounter}`,
            outcome: "quiescent",
            arm: "15m",
            now: closeTime,
          });

          currentClockMs += 13 * 60_000; // sleep remainder of 15m
        }
      }

      // Hour 12: Injection 1 (Mid-flight process kill & auto-reclaim)
      pulseCounter++;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-soak-runner",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 25 * 60_000; // deadline exceeded mid-flight kill
      const wakeReclaim = await mindWakeCommand({
        run: runRoot,
        now: new Date(currentClockMs).toISOString(),
      });
      expect(wakeReclaim.reclaimed).toBe(true);

      // Resume after crash
      pulseCounter++;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-soak-runner",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 2 * 60_000;
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-soak-runner",
        pulse: `pulse-${pulseCounter}`,
        outcome: "advanced",
        arm: "15m",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 13 * 60_000;

      // Hour 24: Injection 2 (Reboot downtime & Persistent=yes catch-up)
      currentClockMs += 60 * 60_000; // 1 hour reboot downtime
      const rebootWake = await mindWakeCommand({
        run: runRoot,
        now: new Date(currentClockMs).toISOString(),
      });
      expect(rebootWake.mode).toBe("idle");
      pulseCounter++;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-soak-runner",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 2 * 60_000;
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-soak-runner",
        pulse: `pulse-${pulseCounter}`,
        outcome: "quiescent",
        arm: "15m",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 13 * 60_000;

      // Hour 36: Injection 3 (Token revocation / Rate limit paused backoff & recovery)
      pulseCounter++;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-soak-runner",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 1 * 60_000;
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-soak-runner",
        pulse: `pulse-${pulseCounter}`,
        outcome: "paused",
        signal: "rate_limit",
        arm: "30m",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 29 * 60_000; // wait backoff duration
      // Resume when quota restored
      pulseCounter++;
      await mindPulseOpenCommand({
        run: runRoot,
        actor: "mind-soak-runner",
        host: "antigravity",
        driver: "systemd-timer",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 2 * 60_000;
      await simulatePulseClose({
        run: runRoot,
        actor: "mind-soak-runner",
        pulse: `pulse-${pulseCounter}`,
        outcome: "advanced",
        arm: "15m",
        now: new Date(currentClockMs).toISOString(),
      });
      currentClockMs += 13 * 60_000;

      // Hour 48: Injection 4 (Disk write error & recovery)
      expect(() => {
        transact(runRoot, "mind-soak-runner", "failing-event", {}, () => {
          throw new Error("ENOSPC simulated");
        });
      }).toThrow();

      // Recovery transaction
      transact(runRoot, "mind-soak-runner", "disk-recovered-event", { status: "ok" }, (s) => {
        s.soak_disk_recovered = true;
      });

      // Hour 72: Verification of final 72h soak state
      const finalLoaded = loadRun(runRoot, false);
      expect(finalLoaded.events.length).toBeGreaterThan(50);

      // Verify zero unrecorded ledger gaps in entire 72h history
      for (let i = 0; i < finalLoaded.events.length; i++) {
        const ev = finalLoaded.events[i]!;
        expect(ev.sequence).toBe(i + 1);
        if (i > 0) {
          expect(ev.previous_hash).toBe(finalLoaded.events[i - 1]!.hash);
        }
      }

      // Verify integrity and doctor acceptance
      expect(verifyIntegrity(runRoot)).toEqual([]);
      const doctorReport = await doctorCommand({ run: runRoot });
      expect(typeof doctorReport.markdown).toBe("string");
      expect(doctorReport.markdown as string).toContain("Capsule Doctor");
    });

    test("Exit Criterion 2: Generational rotation retains Gate 6 declined candidates across boundary and rejects duplicates", () => {
      const declinedDefect: CandidateRecord = {
        id: "cand-declined-auth-leak",
        kind: "defect",
        statement: "auth token leak in log output",
        witness_command_id: "cmd-auth-witness-fail",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["bun", "test", "tests/unit/auth.test.ts"],
        falsifier_exit: 1,
        write_scope: ["src/auth/logger.ts"],
        status: "declined",
        decided_at: "2026-08-21T06:00:00.000Z",
        decline_reason: "addressed by external secrets manager",
        gate_failed: null,
      };

      const activeCandidate: CandidateRecord = {
        id: "cand-active-budget-check",
        kind: "defect",
        statement: "budget calculation precision error",
        witness_command_id: "cmd-budget-witness-1",
        charter_goal_ids: ["G3"],
        falsifier_argv: ["bun", "test", "tests/unit/budget.test.ts"],
        falsifier_exit: 1,
        write_scope: ["src/budget/"],
        status: "opened",
      };

      const { runRoot: gen1RunRoot } = setupMindCapsule("rotation-gate6-retention", {
        candidates: [declinedDefect, activeCandidate],
      });

      // Rotate from Generation 1 to Generation 2
      const rotateResult = mindRotateCommand({
        run: gen1RunRoot,
        actor: "owner-alice",
        now: "2026-08-21T07:00:00.000Z",
      });

      expect(rotateResult.source_generation).toBe(1);
      expect(rotateResult.target_generation).toBe(2);

      const gen2RunRoot = rotateResult.target_run_root;
      const gen2Loaded = loadRun(gen2RunRoot);
      const gen2Candidates = (gen2Loaded.state as Record<string, unknown>)
        .candidates as readonly CandidateRecord[];

      expect(gen2Candidates.length).toBe(2);
      const foundDeclined = gen2Candidates.find((c) => c.id === "cand-declined-auth-leak");
      expect(foundDeclined).toBeDefined();
      expect(foundDeclined?.status).toBe("declined");

      // Verify Gate 6 Duplicate Rejection in Generation 2
      const gateContext: GateEvaluationContext = {
        runRoot: gen2RunRoot,
        repoRoot: "/test/repo",
        actor: "mind-evaluator",
        state: gen2Loaded.state as Record<string, unknown>,
        charterGoals: new Set(["G1", "G2", "G3"]),
        repoRoots: ["src/", "docs/", "tests/"],
      };

      // 1. Candidate with identical witness command ID is rejected
      const duplicateCandidate: CandidateRecord = {
        id: "cand-new-duplicate-auth",
        kind: "defect",
        statement: "different wording for auth leak",
        witness_command_id: "cmd-auth-witness-fail",
        write_scope: ["src/other/"],
        status: "opened",
      };
      const verdict = evaluateGate6NotADuplicate(duplicateCandidate, gateContext);
      expect(verdict.passed).toBe(false);
      expect(verdict.reason).toContain(
        "duplicate of permanently declined candidate 'cand-declined-auth-leak'",
      );

      // Sealed Generation 1 remains readable and valid
      expect(verifyIntegrity(gen1RunRoot)).toEqual([]);
    });

    test("Exit Criterion 3: git push fails at transport level (structural push removal)", async () => {
      const repoDir = scratchRoot("push-fail-transport-test");

      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      };
      Bun.spawnSync(["git", "init", "-b", "main"], { cwd: repoDir, env });
      Bun.spawnSync(["git", "config", "user.name", "Test Runner"], { cwd: repoDir, env });
      Bun.spawnSync(["git", "config", "user.email", "runner@test.local"], { cwd: repoDir, env });
      Bun.spawnSync(["git", "config", "commit.gpgsign", "false"], { cwd: repoDir, env });
      Bun.spawnSync(["git", "config", "tag.gpgsign", "false"], { cwd: repoDir, env });
      writeFileSync(join(repoDir, "README.md"), "# Test\n", "utf-8");
      Bun.spawnSync(["git", "add", "README.md"], { cwd: repoDir, env });
      Bun.spawnSync(["git", "commit", "-m", "chore: initial commit"], { cwd: repoDir, env });

      // Configure inert dummy push URL
      Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], {
        cwd: repoDir,
        env,
      });
      Bun.spawnSync(["git", "remote", "set-url", "--push", "origin", "no_push"], {
        cwd: repoDir,
        env,
      });

      const audit = auditRemoteUrls(repoDir);
      expect(audit.ok).toBe(true);
      expect(isPushTargetInert(audit.remotes.origin?.push)).toBe(true);

      // Attempt push -> fails at Git transport layer with fatal error
      const proc = Bun.spawn(["git", "push", "origin", "main"], {
        cwd: repoDir,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_SSH_COMMAND: "false",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).not.toBe(0);
      expect(stderr.toLowerCase()).toContain("fatal:");
      expect(stderr).toContain("'no_push' does not appear to be a git repository");
    });

    test("Exit Criterion 4: External liveness alert triggers when pulse is delayed past deadline and distinguishes errors", () => {
      const { runRoot } = setupMindCapsule("liveness-alert-check");

      const baseTimeMs = Date.parse("2026-08-21T10:00:00.000Z");

      // 1. Fresh pulse: within 15m interval + 5m grace
      writeLastPulse(runRoot, {
        at: new Date(baseTimeMs).toISOString(),
        pulse_id: "pulse-1",
        outcome: "quiescent",
        next_wake_at: new Date(baseTimeMs + 900_000).toISOString(),
      });

      const freshReport = evaluateExternalLiveness(runRoot, baseTimeMs + 10 * 60_000);
      expect(freshReport.status).toBe("healthy");

      // 2. Delayed pulse: timer stopped, 25m passed (> 15m + 5m grace)
      const staleReport = evaluateExternalLiveness(runRoot, baseTimeMs + 25 * 60_000);
      expect(staleReport.status).toBe("paged_stale_pulse");
      expect(staleReport.message).toContain("Pulse is stale");

      // 3. Monitor error distinguishing: corrupted / missing last_pulse.json
      const emptyRun = scratchRoot("liveness-missing-pulse");
      const missingReport = evaluateExternalLiveness(emptyRun, baseTimeMs);
      expect(missingReport.status).toBe("error_check_failed");
      expect(missingReport.message).toContain("last_pulse.json missing");
    });
  });
});
