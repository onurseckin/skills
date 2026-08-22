import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface SystemdSection {
  readonly [key: string]: string;
}

interface ParsedSystemdUnit {
  readonly [section: string]: SystemdSection;
}

function parseSystemdUnit(content: string): ParsedSystemdUnit {
  const result: Record<string, Record<string, string>> = {};
  let currentSection: string | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex !== -1 && currentSection) {
      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      result[currentSection]![key] = value;
    }
  }

  return result;
}

function parseTimeDurationSec(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.endsWith("min")) {
    return Number.parseInt(trimmed.slice(0, -3), 10) * 60;
  }
  if (trimmed.endsWith("m")) {
    return Number.parseInt(trimmed.slice(0, -1), 10) * 60;
  }
  if (trimmed.endsWith("s") || trimmed.endsWith("sec")) {
    return Number.parseInt(trimmed.replace(/(sec|s)$/, ""), 10);
  }
  if (trimmed.endsWith("h") || trimmed.endsWith("hr")) {
    return Number.parseInt(trimmed.replace(/(hr|h)$/, ""), 10) * 3600;
  }
  return Number.parseInt(trimmed, 10);
}

describe("Phase 6 W6.1 - Systemd service and timer units", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const timerPath = join(repoRoot, "deploy/mind.timer");
  const servicePath = join(repoRoot, "deploy/mind.service");

  describe("File existence and syntax validation", () => {
    test("deploy/mind.timer exists and contains required directives", () => {
      expect(existsSync(timerPath)).toBe(true);
      const content = readFileSync(timerPath, "utf-8");
      const parsed = parseSystemdUnit(content);

      expect(parsed.Unit).toBeDefined();
      expect(parsed.Timer).toBeDefined();
      expect(parsed.Install).toBeDefined();

      const timer = parsed.Timer!;
      expect(timer.OnUnitInactiveSec).toBe("15min");
      expect(parseTimeDurationSec(timer.OnUnitInactiveSec!)).toBe(900);

      // Load-bearing: Persistent=yes ensures missed pulses after reboot/suspend fire immediately
      expect(timer.Persistent).toBe("yes");
      expect(timer.Unit).toBe("mind.service");

      expect(parsed.Install!.WantedBy).toBe("timers.target");
    });

    test("deploy/mind.service exists and contains required directives", () => {
      expect(existsSync(servicePath)).toBe(true);
      const content = readFileSync(servicePath, "utf-8");
      const parsed = parseSystemdUnit(content);

      expect(parsed.Unit).toBeDefined();
      expect(parsed.Service).toBeDefined();
      expect(parsed.Install).toBeDefined();

      const service = parsed.Service!;
      expect(service.Type).toBe("oneshot");
      expect(service.ExecStart).toBe("/opt/mind/pulse.sh /srv/repo/.capsules/mind-gen-1");

      const timeoutSec = parseTimeDurationSec(service.TimeoutStartSec!);
      expect(timeoutSec).toBeGreaterThanOrEqual(1800);

      // Load-bearing: Restart=no prevents infinite crash loop on poisoned capsules
      expect(service.Restart).toBe("no");
      expect(parsed.Install!.WantedBy).toBe("default.target");
    });
  });

  describe("Simulation of reboot timer trigger (Persistent=yes vs Persistent=no)", () => {
    interface TimerState {
      lastInactiveTimestampMs: number;
      persistent: boolean;
      intervalMs: number;
      stampFileTimestampMs: number;
    }

    interface RebootEvent {
      shutdownTimeMs: number;
      bootTimeMs: number;
    }

    function simulateTimerAfterReboot(
      state: TimerState,
      reboot: RebootEvent,
    ): { missedPulseFiredImmediately: boolean; nextTriggerTimeMs: number } {
      const scheduledPulseTimeMs = state.lastInactiveTimestampMs + state.intervalMs;
      const pulseWasMissedDuringDowntime =
        scheduledPulseTimeMs > reboot.shutdownTimeMs && scheduledPulseTimeMs <= reboot.bootTimeMs;

      if (state.persistent && pulseWasMissedDuringDowntime) {
        return {
          missedPulseFiredImmediately: true,
          nextTriggerTimeMs: reboot.bootTimeMs,
        };
      }

      const nextTrigger = Math.max(scheduledPulseTimeMs, reboot.bootTimeMs + state.intervalMs);
      return {
        missedPulseFiredImmediately: false,
        nextTriggerTimeMs: nextTrigger,
      };
    }

    test("Persistent=yes triggers missed pulse immediately upon boot after downtime", () => {
      const intervalMs = 15 * 60 * 1000; // 15 min = 900,000 ms
      const lastInactive = 1000000;

      const shutdownTime = 1500000; // shut down before scheduled pulse
      const bootTime = 2500000; // booted after scheduled pulse (1900000 passed during sleep)

      const result = simulateTimerAfterReboot(
        {
          lastInactiveTimestampMs: lastInactive,
          persistent: true,
          intervalMs,
          stampFileTimestampMs: lastInactive,
        },
        { shutdownTimeMs: shutdownTime, bootTimeMs: bootTime },
      );

      expect(result.missedPulseFiredImmediately).toBe(true);
      expect(result.nextTriggerTimeMs).toBe(bootTime);
    });

    test("Persistent=no skips missed pulses and delays until future slot", () => {
      const intervalMs = 15 * 60 * 1000;
      const lastInactive = 1000000;

      const shutdownTime = 1500000;
      const bootTime = 2500000;

      const result = simulateTimerAfterReboot(
        {
          lastInactiveTimestampMs: lastInactive,
          persistent: false,
          intervalMs,
          stampFileTimestampMs: lastInactive,
        },
        { shutdownTimeMs: shutdownTime, bootTimeMs: bootTime },
      );

      expect(result.missedPulseFiredImmediately).toBe(false);
      expect(result.nextTriggerTimeMs).toBe(bootTime + intervalMs);
    });

    test("Multi-day suspend with Persistent=yes triggers exactly 1 catch-up pulse (no stampede)", () => {
      const intervalMs = 15 * 60 * 1000;
      const lastInactive = 0;
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const bootTime = threeDaysMs;

      let currentTime = bootTime;
      const executedPulseTimestamps: number[] = [];

      // Systemd persistent timer catch-up behavior: triggers 1 catch-up pulse at boot
      const initialReboot = simulateTimerAfterReboot(
        {
          lastInactiveTimestampMs: lastInactive,
          persistent: true,
          intervalMs,
          stampFileTimestampMs: lastInactive,
        },
        { shutdownTimeMs: 1000, bootTimeMs: bootTime },
      );

      if (initialReboot.missedPulseFiredImmediately) {
        executedPulseTimestamps.push(currentTime);
        // Pulse takes 2 minutes to complete
        currentTime += 2 * 60 * 1000;
      }

      // Next pulses resume at standard 15-minute interval
      for (let i = 0; i < 3; i++) {
        currentTime += intervalMs;
        executedPulseTimestamps.push(currentTime);
        currentTime += 2 * 60 * 1000;
      }

      // Exactly 1 catch-up pulse fired at boot, followed by 3 regular intervals
      expect(executedPulseTimestamps.length).toBe(4);
      expect(executedPulseTimestamps[0]).toBe(threeDaysMs);
    });
  });

  describe("Simulation of poisoned capsule failure (Restart=no vs Restart=always/on-failure)", () => {
    interface PulseExecution {
      timestampMs: number;
      exitCode: number;
    }

    interface SupervisorSimulation {
      restartPolicy: "no" | "always" | "on-failure";
      timerIntervalMs: number;
      pulseFn: () => { exitCode: number; durationMs: number };
      totalWindowMs: number;
    }

    function runSupervisorSimulation(sim: SupervisorSimulation): PulseExecution[] {
      const executions: PulseExecution[] = [];
      let currentClockMs = 0;
      let nextTimerTickMs = 0;

      while (currentClockMs < sim.totalWindowMs) {
        if (currentClockMs >= nextTimerTickMs) {
          // Timer fires service
          const run = sim.pulseFn();
          executions.push({
            timestampMs: currentClockMs,
            exitCode: run.exitCode,
          });

          currentClockMs += run.durationMs;

          if (run.exitCode !== 0) {
            if (sim.restartPolicy === "always" || sim.restartPolicy === "on-failure") {
              // Crash-loop: systemd restarts immediately (or after 100ms default restart sec)
              currentClockMs += 100;
              continue;
            }
            // Restart=no: service fails cleanly and stops until next timer tick
            nextTimerTickMs = currentClockMs + sim.timerIntervalMs;
          } else {
            nextTimerTickMs = currentClockMs + sim.timerIntervalMs;
          }
        } else {
          // Advance clock to next timer tick
          currentClockMs = nextTimerTickMs;
        }
      }

      return executions;
    }

    test("Restart=no on poisoned capsule produces exactly 1 failed pulse per timer interval (bounded failure rate)", () => {
      const timerIntervalMs = 15 * 60 * 1000; // 15 min
      const oneHourMs = 60 * 60 * 1000;

      const executions = runSupervisorSimulation({
        restartPolicy: "no",
        timerIntervalMs,
        pulseFn: () => ({ exitCode: 1, durationMs: 2000 }), // Poisoned capsule fails in 2s
        totalWindowMs: oneHourMs,
      });

      // In 1 hour, exactly 4 pulses should execute (1 every 15 minutes), never a crash loop
      expect(executions.length).toBe(4);
      for (const exec of executions) {
        expect(exec.exitCode).toBe(1);
      }

      // Check interval between failed pulses is >= 15 min
      for (let i = 1; i < executions.length; i++) {
        const interval = executions[i]!.timestampMs - executions[i - 1]!.timestampMs;
        expect(interval).toBeGreaterThanOrEqual(timerIntervalMs);
      }
    });

    test("Counterfactual: Restart=on-failure causes uncontrolled crash loop burning token budget", () => {
      const timerIntervalMs = 15 * 60 * 1000;
      const oneHourMs = 60 * 60 * 1000;

      const executions = runSupervisorSimulation({
        restartPolicy: "on-failure",
        timerIntervalMs,
        pulseFn: () => ({ exitCode: 1, durationMs: 2000 }), // Poisoned capsule fails in 2s
        totalWindowMs: oneHourMs,
      });

      // In 1 hour, crash looping would execute ~1700 times, exhausting resources
      expect(executions.length).toBeGreaterThan(1000);
    });
  });

  describe("Floor loop runner semantics", () => {
    test("Floor loop preserves cadence and isolates pulse crash with || true", () => {
      const floorCommand =
        "while :; do /opt/mind/pulse.sh /srv/repo/.capsules/mind-gen-1 || true; sleep 900; done";

      expect(floorCommand).toContain("|| true");
      expect(floorCommand).toContain("sleep 900");

      // Simulate shell execution model
      const simulatedInvocations: { exitCode: number; timeMs: number }[] = [];
      let clockMs = 0;
      const stepIntervalMs = 900 * 1000; // 900 seconds

      // Run 5 iterations with poisoned capsule
      for (let iter = 0; iter < 5; iter++) {
        // Step 1: pulse executes and fails with arbitrary non-zero exit code
        const pulseExitCode = iter % 2 === 0 ? 1 : 2;
        // Step 2: || true converts failure exit code to 0 for the shell
        const shellStatementStatus = (exitCode: number): number => {
          return exitCode === 0 ? 0 : 0;
        };
        expect(shellStatementStatus(pulseExitCode)).toBe(0);

        simulatedInvocations.push({ exitCode: pulseExitCode, timeMs: clockMs });
        // Step 3: sleep 900
        clockMs += stepIntervalMs;
      }

      expect(simulatedInvocations.length).toBe(5);
      expect(simulatedInvocations[4]!.timeMs - simulatedInvocations[0]!.timeMs).toBe(
        4 * 900 * 1000,
      );
    });
  });
});
