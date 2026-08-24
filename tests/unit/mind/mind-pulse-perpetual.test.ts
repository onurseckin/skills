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
} from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { readLastPulse } from "../../../olt/scripts/src/mind/last-pulse.ts";
import {
  enforceInfiniteMindCadence,
  transitionPulseToWake,
} from "../../../olt/scripts/src/mind/recycler.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

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

  describe("Non-Stopping Invariant & Recycler Transitions", () => {
    test("enforceInfiniteMindCadence guarantees infinite autonomous cadence", () => {
      const assessment = enforceInfiniteMindCadence({
        runRoot: ".olt/capsules/mind-gen-1",
        actor: "mind-1",
      });

      expect(assessment.cadence).toBe("infinite_autonomous");
      expect(assessment.allowed).toBe(true);
      expect(assessment.nextInstruction).toContain("mind:wake");
    });

    test("transitionPulseToWake provides seamless transition without process termination", () => {
      const transition = transitionPulseToWake(".olt/capsules/mind-gen-1", "pulse-5", "active");

      expect(transition.canRecycle).toBe(true);
      expect(transition.infiniteCadence).toBe(true);
      expect(transition.transition).toBe("pulse_to_wake");
      expect(transition.nextRecommendedCommand).toContain("mind:wake");
    });
  });

  describe("Refusals and Safety Gates", () => {
    test("refuses pulse when mind is halted", async () => {
      const fixture = setupMindFixture("halted-guard");

      transact(
        fixture.run,
        "safety",
        "mind-halted",
        { reason: "owner intervention" },
        (working) => {
          working.mind = {
            halted: true,
            halt_reason: "owner intervention",
          } as unknown as JsonObject;
        },
      );

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
        }),
      ).rejects.toThrow(/mind is halted/);
    });

    test("refuses pulse when charter sha mismatch occurs", async () => {
      const fixture = setupMindFixture("drift-guard");

      writeFileSync(fixture.charterPath, "# DRIFTED CONTENT\n", "utf-8");

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
        }),
      ).rejects.toThrow(/charter sha256 mismatch/);
    });

    test("refuses pulse when past deadline until reclaimed", async () => {
      const fixture = setupMindFixture("deadline-expired");
      const openTime = "2026-08-22T10:00:00.000Z";
      const farFutureTime = "2026-08-22T12:00:00.000Z"; // 2 hours later, past 20m deadline

      await mindPulseCommand({
        run: fixture.run,
        actor: "mind-1",
        now: openTime,
      });

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
          now: farFutureTime,
        }),
      ).rejects.toThrow(/reclaim it first with mind:wake/);
    });
  });

  describe("Mechanical Rejection of Permanently Deleted mind:pulse-close", () => {
    test("findCommand returns undefined for mind:pulse-close", () => {
      const spec = findCommand("mind:pulse-close");
      expect(spec).toBeUndefined();
    });

    test("findCommand successfully returns spec for unified mind:pulse", () => {
      const spec = findCommand("mind:pulse");
      expect(spec).toBeDefined();
      expect(spec?.name).toBe("mind:pulse");
      expect(spec?.domain).toBe("mind");
    });

    test("CLI execute mechanically rejects mind:pulse-close with UNKNOWN_COMMAND", async () => {
      const fixture = setupMindFixture("cli-rejection");

      await expect(
        execute([
          "mind:pulse-close",
          "--run",
          fixture.run,
          "--actor",
          "mind-1",
          "--pulse",
          "pulse-1",
          "--outcome",
          "quiescent",
        ]),
      ).rejects.toThrow(/unknown command: mind:pulse-close/);
    });

    test("CLI execute successfully dispatches unified mind:pulse", async () => {
      const fixture = setupMindFixture("cli-dispatch");

      const res = await execute(["mind:pulse", "--run", fixture.run, "--actor", "mind-1"]);
      expect(res.status).toBe("opened");
      expect(res.pulse_id).toBe("pulse-1");
      expect(res.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
    });
  });
});
