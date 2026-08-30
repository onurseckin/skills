import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  mindPulseCommand,
} from "../../../olt/scripts/src/cli/commands/index.ts";
import { execute } from "../../../olt/scripts/src/cli/index.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { readLastPulse } from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  enforceInfiniteMindCadence,
  transitionPulseToWake,
} from "../../../olt/scripts/src/mind/archival/recycler/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore test cleanup errors
    }
  }
  testRoots.length = 0;
});

interface MindTestFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindFixture(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
  } = {},
): MindTestFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-pulse-perpetual-${name}-`));
  testRoots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  mkdirSync(join(repo, ".olt"), { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Perpetual Mind"\n  goals:\n    - id: "G1"\n      statement: "Infinite Stability"\n  non_goals:\n    - "Self-termination"\n  repo_roots:\n    - "src/"\n`;
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
          goals: ["G1"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };
      if (overrides.budget) {
        working.budget = overrides.budget as unknown as JsonObject;
      }
    },
  );

  return { repo, run, charterPath, charterSha };
}

describe("P43 Unified Perpetual mind:pulse Command", () => {
  describe("Automatic Pulse Opening When No Active Pulse", () => {
    test("automatically opens a new perpetual pulse when no pulse is open", async () => {
      const fixture = setupMindFixture("auto-open");
      const timestamp = "2026-08-22T10:00:00.000Z";

      const result = await mindPulseCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "perpetual-loop",
        now: timestamp,
      });

      expect(result.status).toBe("opened");
      expect(result.action).toBe("opened");
      expect(result.pulse_id).toBe("pulse-1");
      expect(result.actor).toBe("mind-1");
      expect(result.host).toBe("antigravity");
      expect(result.driver).toBe("perpetual-loop");
      expect(result.opened_at).toBe(timestamp);
      expect(result.cadence).toBe("infinite_autonomous");
      expect(result.closing_permitted).toBe(false);
      expect(result.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
      expect(result.scheduled_interval_ms).toBe(900_000);
      expect(result.next_wake_at).toBe("2026-08-22T10:15:00.000Z");

      // Verify state was mutated and durable
      const loaded = loadRun(fixture.run, false);
      const pulseState = (loaded.state.pulse ?? {}) as Record<string, unknown>;
      expect(pulseState.counter).toBe(1);
      const open = pulseState.open as Record<string, unknown>;
      expect(open).toBeDefined();
      expect(open.pulse_id).toBe("pulse-1");
      expect(open.cadence).toBe("infinite_autonomous");
      expect(open.closing_permitted).toBe(false);

      // Verify event recorded in hash chain
      const lastEvent = loaded.events[loaded.events.length - 1];
      expect(lastEvent?.kind).toBe("mind-pulse-opened");
      expect(lastEvent?.payload.pulse_id).toBe("pulse-1");

      // Verify last_pulse.json written with outcome: active
      const lastPulse = readLastPulse(fixture.run);
      expect(lastPulse).not.toBeNull();
      expect(lastPulse?.pulse_id).toBe("pulse-1");
      expect(lastPulse?.outcome).toBe("active");
      expect(lastPulse?.next_wake_at).toBe("2026-08-22T10:15:00.000Z");
    });

    test("respects custom arm interval duration when opening", async () => {
      const fixture = setupMindFixture("arm-open");
      const timestamp = "2026-08-22T10:00:00.000Z";

      const result = await mindPulseCommand({
        run: fixture.run,
        actor: "mind-worker",
        arm: "30m",
        now: timestamp,
      });

      expect(result.status).toBe("opened");
      expect(result.scheduled_interval_ms).toBe(1_800_000);
      expect(result.next_wake_at).toBe("2026-08-22T10:30:00.000Z");
    });
  });

  describe("Active Pulse Telemetry When Pulse Is Open", () => {
    test("outputs active pulse telemetry and next scheduled interval when pulse is already open", async () => {
      const fixture = setupMindFixture("telemetry-active");
      const openTimestamp = "2026-08-22T10:00:00.000Z";
      const checkTimestamp = "2026-08-22T10:05:00.000Z";

      // 1. Initial call opens pulse-1
      const initial = await mindPulseCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "systemd-timer",
        now: openTimestamp,
      });
      expect(initial.status).toBe("opened");
      expect(initial.action).toBe("opened");

      // 2. Subsequent call returns active telemetry without double-opening or erroring
      const telemetry = await mindPulseCommand({
        run: fixture.run,
        actor: "mind-1",
        now: checkTimestamp,
      });

      expect(telemetry.status).toBe("active");
      expect(telemetry.action).toBe("telemetry");
      expect(telemetry.pulse_id).toBe("pulse-1");
      expect(telemetry.actor).toBe("mind-1");
      expect(telemetry.host).toBe("antigravity");
      expect(telemetry.driver).toBe("systemd-timer");
      expect(telemetry.opened_at).toBe(openTimestamp);
      expect(telemetry.scheduled_interval_ms).toBe(900_000);
      expect(telemetry.next_wake_at).toBe("2026-08-22T10:20:00.000Z");
      expect(telemetry.cadence).toBe("infinite_autonomous");
      expect(telemetry.closing_permitted).toBe(false);
      expect(telemetry.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);

      // Verify no duplicate mind-pulse-opened event was appended
      const loaded = loadRun(fixture.run, false);
      const openEvents = loaded.events.filter((e) => e.kind === "mind-pulse-opened");
      expect(openEvents.length).toBe(1);
    });

    test("formats markdown brief within strict line limits", () => {
      const activeBrief = formatMindPulseActiveBrief({
        pulseId: "pulse-42",
        runRoot: ".olt/capsules/mind-gen-1",
        actor: "mind-1",
        host: "antigravity",
        driver: "perpetual-loop",
        openedAt: "2026-08-22T10:00:00.000Z",
        deadlineAt: "2026-08-22T10:20:00.000Z",
        scheduledIntervalMs: 900_000,
        nextWakeAt: "2026-08-22T10:15:00.000Z",
        pulsesToday: 5,
        pulsesPerDay: 96,
      });

      expect(activeBrief).toContain("Mind Pulse Active: pulse-42");
      expect(activeBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
      expect(activeBrief.split("\n").length).toBeLessThanOrEqual(25);

      const openedBrief = formatMindPulseOpenedBrief({
        pulseId: "pulse-1",
        runRoot: ".olt/capsules/mind-gen-1",
        actor: "mind-1",
        host: "antigravity",
        driver: "perpetual-loop",
        openedAt: "2026-08-22T10:00:00.000Z",
        deadlineAt: "2026-08-22T10:20:00.000Z",
        scheduledIntervalMs: 900_000,
        nextWakeAt: "2026-08-22T10:15:00.000Z",
        pulsesToday: 1,
        pulsesPerDay: 96,
      });

      expect(openedBrief).toContain("Mind Pulse Opened: pulse-1");
      expect(openedBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
      expect(openedBrief.split("\n").length).toBeLessThanOrEqual(25);
    });
  });
});
