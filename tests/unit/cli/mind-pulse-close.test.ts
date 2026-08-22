import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatMindPulseCloseBrief,
  mindPulseCloseCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-pulse-close.ts";
import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { readLastPulse } from "../../../orchestrating-long-tasks/scripts/src/mind/last-pulse.ts";
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
  const repo = mkdtempSync(join(tmpdir(), `cli-pulse-close-test-${name}-`));
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

  return { repo, run, charterPath, charterSha };
}

describe("CLI command: mind:pulse-close", () => {
  describe("Validation & Refusals", () => {
    test("throws HarnessError when --pulse is missing", async () => {
      const fixture = setupMindCapsule("missing-pulse-flag");
      expect(
        mindPulseCloseCommand({
          run: fixture.run,
          actor: "mind-1",
          outcome: "quiescent",
          arm: "15m",
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("throws HarnessError when no active pulse is open", async () => {
      const fixture = setupMindCapsule("no-open-pulse", { pulseOpen: null });
      expect(
        mindPulseCloseCommand({
          run: fixture.run,
          actor: "mind-1",
          pulse: "pulse-1",
          outcome: "quiescent",
          arm: "15m",
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("throws HarnessError when actor does not match open pulse actor", async () => {
      const fixture = setupMindCapsule("wrong-actor");
      expect(
        mindPulseCloseCommand({
          run: fixture.run,
          actor: "imposter",
          pulse: "pulse-1",
          outcome: "quiescent",
          arm: "15m",
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("throws HarnessError when pulse id does not match open pulse id", async () => {
      const fixture = setupMindCapsule("wrong-pulse-id");
      expect(
        mindPulseCloseCommand({
          run: fixture.run,
          actor: "mind-1",
          pulse: "pulse-999",
          outcome: "quiescent",
          arm: "15m",
        }),
      ).rejects.toThrow(HarnessError);
    });
  });

  describe("Anti-Idle & Non-Termination Guarantee", () => {
    test("closing a pulse always yields non_terminating true and infinite_autonomous cadence", async () => {
      const fixture = setupMindCapsule("close-active");
      const result = await mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "advanced",
        arm: "15m",
        "arm-mechanism": "systemd-timer",
      });

      expect(result.cadence).toBe("infinite_autonomous");
      expect(result.non_terminating).toBe(true);
      expect(result.pulse_id).toBe("pulse-1");
      expect(result.outcome).toBe("advanced");
      expect(result.next_instruction).toBe(`bun harness.ts mind:wake --run ${fixture.run}`);
      expect(result.markdown).toContain("infinite autonomous loop active");
    });

    test("terminal outcome halted still enforces infinite autonomous cadence and yields autonomous next instruction", async () => {
      const fixture = setupMindCapsule("close-halted-cadence");
      const result = await mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "halted",
        "terminal-reason": "emergency pause",
      });

      expect(result.cadence).toBe("infinite_autonomous");
      expect(result.non_terminating).toBe(true);
      expect(result.outcome).toBe("halted");
      expect(result.next_wake_at).toBeNull();
      expect(result.next_instruction).toBe(`bun harness.ts mind:wake --run ${fixture.run}`);
      expect(result.markdown).toContain("infinite autonomous loop active");
    });

    test("routes next instruction to admitted candidate when available", async () => {
      const fixture = setupMindCapsule("close-with-candidate");

      transact(
        fixture.run,
        "mind-1",
        "candidate-admitted",
        { id: "cand-p00" },
        (working) => {
          working.candidates = [
            {
              id: "cand-p00",
              kind: "defect",
              statement: "Implement perpetual cadence",
              charter_goal: "G1",
              write_scope: ["src/"],
              status: "admitted",
            },
          ] as unknown as JsonObject;
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
      expect(result.non_terminating).toBe(true);
      expect(result.next_instruction).toBe(
        `bun harness.ts mind:admit --run ${fixture.run} --candidate cand-p00`,
      );
      expect(result.markdown).toContain(
        `bun harness.ts mind:admit --run ${fixture.run} --candidate cand-p00`,
      );
    });

    test("writes durable last_pulse.json with outcome and next wake time", async () => {
      const fixture = setupMindCapsule("durable-last-pulse");
      const now = "2026-08-21T06:00:00.000Z";

      await mindPulseCloseCommand({
        run: fixture.run,
        actor: "mind-1",
        pulse: "pulse-1",
        outcome: "quiescent",
        arm: "15m",
        now,
      });

      const lastPulse = readLastPulse(fixture.run);
      expect(lastPulse?.pulse_id).toBe("pulse-1");
      expect(lastPulse?.outcome).toBe("quiescent");
      expect(lastPulse?.next_wake_at).toBe("2026-08-21T06:15:00.000Z");
    });
  });

  describe("formatMindPulseCloseBrief", () => {
    test("formats brief within 20 line limit with non-terminating cadence statement", () => {
      const brief = formatMindPulseCloseBrief({
        pulseId: "pulse-42",
        outcome: "quiescent",
        value: 0,
        nextWakeAt: "2026-08-21T06:15:00.000Z",
        armedIntervalMs: 900_000,
        armMechanism: "systemd-timer",
        runRoot: ".capsules/mind-gen-1",
      });

      expect(brief).toContain("### Mind Pulse Closed: pulse-42");
      expect(brief).toContain("- **Outcome**: quiescent");
      expect(brief).toContain("- **Arm Mechanism**: systemd-timer");
      expect(brief).toContain("- **Cadence**: infinite autonomous loop active");
      expect(brief).toContain("bun harness.ts mind:wake --run .capsules/mind-gen-1");

      const lines = brief.split("\n");
      expect(lines.length).toBeLessThanOrEqual(20);
    });
  });
});
