import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  formatMindQuiesceBrief,
  mindQuiesceCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-quiesce.ts";
import {
  loadRun,
  transact,
  verifyIntegrity,
} from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];

function grantAgentRole(run: string, agentId: string, role: string): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

function seedCommands(run: string, commandIds: string[]): void {
  transact(run, "coordinator", "seed-commands", {}, (draft) => {
    const commands = (draft.commands ?? {}) as Record<string, unknown>;
    for (const id of commandIds) {
      commands[id] = { id, exit_code: 0 };
    }
    draft.commands = commands;
  });
}

const ALL_10_SOURCES = [
  "intent-drift:C-cmd-1:0",
  "unused-code:C-cmd-1:0",
  "literal-fallbacks:C-cmd-1:0",
  "open-findings:C-cmd-1:0",
  "escalated-tasks:C-cmd-1:0",
  "failing-gates:C-cmd-1:0",
  "capsule-integrity:C-cmd-1:0",
  "install-drift:C-cmd-1:0",
  "unsealed-capsules:C-cmd-1:0",
  "charter-backlog:C-cmd-1:0",
];

describe("mind:quiesce CLI Command Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  test("formatMindQuiesceBrief formats output properly with and without digest", () => {
    const briefNoDigest = formatMindQuiesceBrief({
      runRoot: "/virtual/runs/test-run",
      actor: "mind-prime",
      quiescentStreak: 3,
      previousStreak: 2,
      baseIntervalMs: 5000,
      maxIntervalMs: 30000,
      armedIntervalMs: 11250,
      digestTriggered: false,
      observedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(briefNoDigest).toContain("### Mind Quiesced (Streak 3)");
    expect(briefNoDigest).toContain("- **Capsule Root**: `/virtual/runs/test-run`");
    expect(briefNoDigest).toContain("- **Actor**: `mind-prime`");
    expect(briefNoDigest).toContain("- **Quiescent Streak**: 3 (previous: 2)");
    expect(briefNoDigest).toContain("- **Digest Triggered**: no");

    const briefWithDigest = formatMindQuiesceBrief({
      runRoot: "/virtual/runs/test-run",
      actor: "mind-prime",
      quiescentStreak: 8,
      previousStreak: 7,
      baseIntervalMs: 5000,
      maxIntervalMs: 30000,
      armedIntervalMs: 30000,
      digestTriggered: true,
      observedAt: "2026-09-01T12:00:00.000Z",
    });

    expect(briefWithDigest).toContain("### Mind Quiesced (Streak 8)");
    expect(briefWithDigest).toContain(
      "- **Digest Triggered**: yes (8th consecutive quiescent pulse)",
    );
  });

  test("mindQuiesceCommand throws for missing or invalid source and timestamp flags", async () => {
    const { run } = await setupCompiledRun("quiesce-flags", roots);
    grantAgentRole(run, "mind-1", "mind");

    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
      }),
    ).rejects.toThrow("--source is required");

    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
        source: [],
      }),
    ).rejects.toThrow("--source is required");

    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
        source: ALL_10_SOURCES,
        now: "not-a-valid-date",
      }),
    ).rejects.toThrow("invalid --now timestamp: not-a-valid-date");
  });

  test("mindQuiesceCommand enforces agent role grants", async () => {
    const { run } = await setupCompiledRun("quiesce-auth", roots);
    seedCommands(run, ["C-cmd-1"]);

    await expect(
      mindQuiesceCommand({
        run,
        actor: "unregistered-agent",
        source: ALL_10_SOURCES,
      }),
    ).rejects.toThrow("agent unregistered-agent holds no grant");

    grantAgentRole(run, "coord-agent", "coordinator");
    await expect(
      mindQuiesceCommand({
        run,
        actor: "coord-agent",
        source: ALL_10_SOURCES,
      }),
    ).rejects.toThrow("holds role 'coordinator'; role 'mind' is required for mind:quiesce");
  });

  test("mindQuiesceCommand validates all 10 sources and fails on short or dirty scans", async () => {
    const { run } = await setupCompiledRun("quiesce-scan-val", roots);
    grantAgentRole(run, "mind-1", "mind");
    seedCommands(run, ["C-cmd-1"]);

    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
        source: ALL_10_SOURCES.slice(0, 9),
      }),
    ).rejects.toThrow("quiescence requires all 10 discovery sources to be scanned; received 9");

    const nonZeroSources = [...ALL_10_SOURCES.slice(0, 9), "charter-backlog:C-cmd-1:3"];
    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
        source: nonZeroSources,
      }),
    ).rejects.toThrow("quiescence refused: non-zero counts detected");

    const unevidencedSources = [...ALL_10_SOURCES.slice(0, 9), "charter-backlog:C-cmd-missing:0"];
    await expect(
      mindQuiesceCommand({
        run,
        actor: "mind-1",
        source: unevidencedSources,
      }),
    ).rejects.toThrow("unrecorded command evidence");
  });

  test("mindQuiesceCommand executes successfully for initial streak 1 without digest", async () => {
    const { run } = await setupCompiledRun("quiesce-streak-1", roots);
    grantAgentRole(run, "mind-1", "mind");
    seedCommands(run, ["C-cmd-1"]);

    const res = await mindQuiesceCommand({
      run,
      actor: "mind-1",
      source: ALL_10_SOURCES,
      now: "2026-09-01T15:00:00.000Z",
    });

    expect(res.quiescent_streak).toBe(1);
    expect(res.previous_streak).toBe(0);
    expect(res.digest_triggered).toBe(false);
    expect(res.digest).toBeUndefined();
    expect(res.base_interval_ms).toBe(res.base_interval_ms);
    expect(res.armed_interval_ms).toBeGreaterThan(0);
    expect(res.sources.length).toBe(10);
    expect(res.observed_at).toBe("2026-09-01T15:00:00.000Z");

    const loaded = loadRun(run, false);
    const pulse = loaded.state.pulse as Record<string, unknown>;
    expect(pulse?.quiescent_streak).toBe(1);
  });

  test("mindQuiesceCommand calculates multiplier, triggers digest at streak 8, and custom budget", async () => {
    const { run } = await setupCompiledRun("quiesce-streak-8", roots);
    grantAgentRole(run, "mind-1", "mind");
    seedCommands(run, ["C-cmd-1"]);

    transact(run, "coordinator", "seed-pulse-budget", {}, (draft) => {
      draft.pulse = { quiescent_streak: 7 };
      draft.budget = { base_interval_ms: 10000, max_interval_ms: 60000 };
    });

    const res = await mindQuiesceCommand({
      run,
      actor: "mind-1",
      source: ALL_10_SOURCES,
      "capsules-dir": "/virtual/coverage/scratch",
    });

    expect(res.quiescent_streak).toBe(8);
    expect(res.previous_streak).toBe(7);
    expect(res.digest_triggered).toBe(true);
    expect(res.digest).toBeDefined();
    expect(res.digest?.streak).toBe(8);
    expect(res.digest?.markdown).toContain("Quiescent Repository Digest (Streak 8)");
    expect(res.base_interval_ms).toBe(10000);
    expect(res.max_interval_ms).toBe(60000);
    expect(res.armed_interval_ms).toBeGreaterThan(10000);

    const loaded = loadRun(run, false);
    const pulse = loaded.state.pulse as Record<string, unknown>;
    expect(pulse?.quiescent_streak).toBe(8);
  });
});
