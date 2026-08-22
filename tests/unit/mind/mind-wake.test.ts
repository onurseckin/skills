import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArguments } from "../../../orchestrating-long-tasks/scripts/src/cli/arguments.ts";
import { mindWakeCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-wake.ts";
import {
  buildWakeBrief,
  deriveLane,
  formatDuration,
  formatNumber,
  formatShortSha,
} from "../../../orchestrating-long-tasks/scripts/src/mind/brief.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

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
    readonly observations?: readonly Record<string, unknown>[];
    readonly eventCount?: number;
    readonly halted?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-wake-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    overrides.charterContent ??
    `# CHARTER\n\n## identity\nTest application\n\n## goals\n- G1: Ensure stability\n\n## non-goals\n- Out of scope\n\n## repo_roots\n- \`src/\`\n`;
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
        ...(overrides.halted ? { halted: true, halt_reason: "test halt" } : {}),
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
        pulses_today: 10,
        wall_clock_ms_today: 1_800_000,
        ...overrides.budget,
      };

      working.pulse = {
        counter: 12,
        open: overrides.pulseOpen !== undefined ? overrides.pulseOpen : null,
        last:
          overrides.pulseLast !== undefined
            ? overrides.pulseLast
            : {
                pulse_id: "pulse-11",
                closed_at: new Date(Date.now() - 900_000).toISOString(),
                outcome: "quiescent",
                value: 0,
                armed_interval_ms: 900_000,
                armed_at: new Date(Date.now() - 1_800_000).toISOString(),
                arm_mechanism: "systemd-timer",
                zero_value_streak: 1,
              },
      };

      working.observations = overrides.observations ?? [
        {
          id: "obs-1",
          source: "intent-drift",
          command_id: "cmd-1",
          count: 3,
          observed_at: new Date(Date.now() - 300_000).toISOString(),
          evidence_class: "harness_observed",
        },
      ];

      working.candidates = [];
      working.escalations = [];
      working.audit = {
        last_started_at: new Date().toISOString(),
        last_verdict: "approved",
        open_findings: [],
      };
    },
  );

  return { repo, run, charterPath, charterSha };
}

describe("mind:wake and Tier A brief", () => {
  test("generates Tier A brief meeting line and byte limits", async () => {
    const { run } = setupMindCapsule("limits");
    const result = await mindWakeCommand({ run: "limits", ...{ run } });

    expect(typeof result.markdown).toBe("string");
    const markdown = result.markdown as string;
    const lines = markdown.split("\n");

    expect(lines.length).toBeLessThanOrEqual(30);

    const byteLength = new TextEncoder().encode(markdown).byteLength;
    expect(byteLength).toBeLessThanOrEqual(2048);

    expect(markdown).toContain("MODE      idle");
    expect(markdown).toContain("CHARTER   ok");
    expect(markdown).toContain("INTEGRITY ok");
    expect(markdown).toContain("BUDGET    10/96 pulses today");
    expect(markdown).toContain("RUNS      0 live");
    expect(markdown).toContain("HEALTH    intent-drift 3");
    expect(markdown).toContain("LANE      quiesce");
    expect(markdown).toContain("NEXT      bun harness.ts mind:pulse-open");
    expect(markdown).toContain("THEN      bun harness.ts mind:pulse-close");
  });

  test("detects charter drift when charter is modified after pinning", async () => {
    const { run, charterPath } = setupMindCapsule("drift");

    // Modify charter file content
    writeFileSync(charterPath, "# CHARTER\n\nModified content by owner\n", "utf-8");

    const result = await mindWakeCommand({ run: "drift", ...{ run } });
    const markdown = result.markdown as string;

    expect(result.mode).toBe("halted");
    expect(result.charter_status).toBe("DRIFTED");
    expect(markdown).toContain("CHARTER   DRIFTED");
    expect(markdown).toContain("MODE      halted");

    const next = result.next as string[];
    expect(next.join(" ")).toContain("mind:escalate");
    expect(next.join(" ")).toContain("charter drifted from pinned digest");

    const then = result.then as string[];
    expect(then.join(" ")).toContain("mind:halt");
  });

  test("detects missing charter file and halts", async () => {
    const { run, charterPath } = setupMindCapsule("missing-charter");

    rmSync(charterPath);

    const result = await mindWakeCommand({ run: "missing-charter", ...{ run } });
    const markdown = result.markdown as string;

    expect(result.mode).toBe("halted");
    expect(result.charter_status).toBe("missing");
    expect(markdown).toContain("CHARTER   missing");
    expect(markdown).toContain("MODE      halted");
  });

  test("reclaims dead pulse open past its deadline", async () => {
    const now = Date.now();
    const expiredDeadline = new Date(now - 60_000).toISOString();
    const openedAt = new Date(now - 1_260_000).toISOString();

    const { run } = setupMindCapsule("reclaim", {
      pulseOpen: {
        pulse_id: "pulse-12",
        opened_at: openedAt,
        deadline_at: expiredDeadline,
        host: "antigravity",
        driver: "manual",
        actor: "mind-worker",
      },
    });

    const result = await mindWakeCommand({
      run: "reclaim",
      ...{ run, now: new Date(now).toISOString() },
    });

    expect(result.reclaimed).toBe(true);
    expect(result.reclaimed_pulse_id).toBe("pulse-12");

    // Check brief
    const markdown = result.markdown as string;
    expect(markdown).toBeDefined();

    // Verify last_pulse.json was written with outcome: crashed
    const lastPulseRaw = readFileSync(join(run, "last_pulse.json"), "utf-8");
    const lastPulse = JSON.parse(lastPulseRaw) as { outcome: string; pulse_id: string };
    expect(lastPulse.outcome).toBe("crashed");
    expect(lastPulse.pulse_id).toBe("pulse-12");
  });

  test("reaches halted state after three consecutive crashes", async () => {
    const now = Date.now();
    const expiredDeadline = new Date(now - 10_000).toISOString();

    const { run } = setupMindCapsule("three-crashes", {
      pulseLast: {
        pulse_id: "pulse-10",
        closed_at: new Date(now - 100_000).toISOString(),
        outcome: "crashed",
        value: 0,
        armed_interval_ms: 900_000,
        armed_at: new Date(now - 200_000).toISOString(),
        arm_mechanism: "crash-recovery",
        zero_value_streak: 2,
        consecutive_crashes: 2,
      },
      pulseOpen: {
        pulse_id: "pulse-11",
        opened_at: new Date(now - 1_000_000).toISOString(),
        deadline_at: expiredDeadline,
        host: "antigravity",
        driver: "manual",
        actor: "mind-1",
      },
    });

    const result = await mindWakeCommand({
      run: "three-crashes",
      ...{ run, now: new Date(now).toISOString() },
    });

    expect(result.reclaimed).toBe(true);
    expect(result.mode).toBe("halted");
    const markdown = result.markdown as string;
    expect(markdown).toContain("MODE      halted");
    expect((result.next as string[]).join(" ")).toContain("mind:escalate");
    expect((result.then as string[]).join(" ")).toContain("mind:halt");
  });

  test("derives lane as defer when budget is exhausted", async () => {
    const { run } = setupMindCapsule("budget-exhausted", {
      budget: {
        pulses_today: 96,
        pulses_per_day: 96,
        wall_clock_ms_today: 5_000_000,
        wall_clock_ms_per_day: 21_600_000,
      },
    });

    const result = await mindWakeCommand({ run: "budget-exhausted", ...{ run } });
    expect(result.mode).toBe("paused");
    expect(result.lane).toBe("defer");
    expect((result.next as string[]).join(" ")).toContain("mind:pulse-open");
    expect((result.then as string[]).join(" ")).toContain("--outcome deferred");
  });

  test("calculates driver GAP correctly", async () => {
    const now = Date.now();
    const closedAt = new Date(now - 17 * 60_000).toISOString();

    const { run } = setupMindCapsule("gap-late", {
      pulseLast: {
        pulse_id: "pulse-5",
        closed_at: closedAt,
        outcome: "quiescent",
        value: 0,
        armed_interval_ms: 15 * 60_000,
        armed_at: new Date(now - 30 * 60_000).toISOString(),
        arm_mechanism: "systemd-timer",
        zero_value_streak: 1,
      },
    });

    const result = await buildWakeBrief(run, { now: new Date(now).toISOString() });
    expect(result.markdown).toContain("GAP       17m (armed 15m; driver late by 2m)");
  });

  test("renders handoff on depth=run", async () => {
    const { run } = setupMindCapsule("depth-run");
    const result = await mindWakeCommand({
      run: "depth-run",
      ...{ run, depth: "run" },
    });

    expect(result.depth).toBe("run");
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown as string).toContain("Harness handoff");
  });

  test("rejects invalid depth parameter", async () => {
    const { run } = setupMindCapsule("depth-invalid");
    await expect(
      mindWakeCommand({
        run: "depth-invalid",
        ...{ run, depth: "invalid-depth" },
      }),
    ).rejects.toThrow("--depth must be brief or run");
  });

  test("pure function deriveLane behaves deterministically", () => {
    expect(
      deriveLane({
        mode: "halted",
        budgetDeferred: false,
        isQuietHours: false,
        staleLeasesCount: 0,
        openFindingsCount: 0,
        liveRuns: [],
      }),
    ).toBe("quiesce");

    expect(
      deriveLane({
        mode: "idle",
        budgetDeferred: true,
        isQuietHours: false,
        staleLeasesCount: 0,
        openFindingsCount: 0,
        liveRuns: [],
      }),
    ).toBe("defer");

    expect(
      deriveLane({
        mode: "idle",
        budgetDeferred: false,
        isQuietHours: false,
        staleLeasesCount: 1,
        openFindingsCount: 0,
        liveRuns: [],
      }),
    ).toBe("rescue");

    expect(
      deriveLane({
        mode: "idle",
        budgetDeferred: false,
        isQuietHours: false,
        staleLeasesCount: 0,
        openFindingsCount: 2,
        liveRuns: [],
      }),
    ).toBe("repair");
  });

  test("helpers formatDuration, formatNumber, formatShortSha format values correctly", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(900_000)).toBe("15m");
    expect(formatDuration(7_860_000)).toBe("2h11m");
    expect(formatDuration(21_600_000)).toBe("6h");

    expect(formatNumber(1284)).toBe("1,284");
    expect(formatNumber(0)).toBe("0");

    expect(formatShortSha("a3f123456789c2")).toBe("a3f1…9c2");
    expect(formatShortSha("abc")).toBe("abc");
  });

  test("brief NEXT and THEN commands have valid syntax and flags", async () => {
    const { run } = setupMindCapsule("valid-syntax");
    const result = await mindWakeCommand({ run: "valid-syntax", ...{ run } });
    const next = result.next as string[];
    const then = result.then as string[];

    expect(next[0]).toBe("bun");
    expect(next[1]).toBe("harness.ts");
    const nextCmd = next[2];
    const nextFlags = next.slice(3);
    const parsedNext = parseArguments([nextCmd, ...nextFlags]);
    expect(parsedNext.command).toBe(nextCmd);

    expect(then[0]).toBe("bun");
    expect(then[1]).toBe("harness.ts");
    const thenCmd = then[2];
    const thenFlags = then.slice(3);
    const parsedThen = parseArguments([thenCmd, ...thenFlags]);
    expect(parsedThen.command).toBe(thenCmd);
  });

  test("prescribes deferred rotation when event sequence reaches 90% of limit", async () => {
    const { run } = setupMindCapsule("headroom");
    const statePath = join(run, "state.json");
    const stateRaw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
    stateRaw.event_sequence = 91_000;
    writeFileSync(statePath, JSON.stringify(stateRaw), "utf-8");

    const result = await mindWakeCommand({ run: "headroom", ...{ run } });
    expect((result.next as string[]).join(" ")).toContain(
      "event sequence head-room limit exceeded",
    );
    expect((result.next as string[]).join(" ")).toContain("--outcome deferred");
  });

  test("renders live runs in RUNS section", async () => {
    const { repo, run } = setupMindCapsule("with-runs");
    const childPrompt = new TextEncoder().encode("Child prompt");
    const childRun = initRun(repo, "worker-run-1", childPrompt, "file", true);
    transact(childRun, "planner", "plan-added", {}, (working) => {
      working.graph = { revision: 1 };
      working.tasks = {
        "task-1": {
          id: "task-1",
          status: "leased",
          lease: { agent_id: "agent-1", expires_at: new Date(Date.now() + 60_000).toISOString() },
          open_finding_ids: [],
        },
        "task-2": { id: "task-2", status: "ready", open_finding_ids: [] },
      };
      working.gates = {
        "gate-1": { id: "gate-1", status: "passed", exit_code: 0 },
      };
    });

    const result = await mindWakeCommand({ run: "with-runs", ...{ run } });
    const markdown = result.markdown as string;
    expect(markdown).toContain("RUNS      1 live");
    expect(markdown).toContain("worker-run-1");
    expect(markdown).toContain("executing");
    expect(markdown).toContain("2 tasks");
    expect(markdown).toContain("1 leased");
    expect(markdown).toContain("gates 1/1 green");
  });
});
