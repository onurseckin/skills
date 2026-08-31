import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
  mindPulseCommand,
} from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  testRoots.length = 0;
});

function setupFixture(name: string): { repo: string; run: string } {
  const repo = mkdtempSync(join(tmpdir(), `mind-pulse-smart-${name}-`));
  testRoots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Mind"\n  goals:\n    - id: "G1"\n      statement: "Goal 1"\n  non_goals:\n    - "Self-termination"\n  repo_roots:\n    - "src/"\n`;
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
    },
  );

  return { repo, run };
}

describe("cli/commands/mind-pulse smart-task integration", () => {
  it("exports canonical CLOSING_FORBIDDEN_FOR_MIND invariant constant", () => {
    expect(CLOSING_FORBIDDEN_FOR_MIND).toBe("CLOSING_FORBIDDEN_FOR_MIND");
  });

  it("formats pulse directive with Mode A proposals when active runs and backlog are zero", () => {
    const output = formatPulseDirective({ activeRuns: 0, pendingBacklog: 0 });
    expect(output).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
    expect(output).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(output).toContain("Discovery Proposals:");
  });

  it("formats empty directive when active runs or pending backlog exist", () => {
    expect(formatPulseDirective({ activeRuns: 1, pendingBacklog: 0 })).toBe("");
    expect(formatPulseDirective({ activeRuns: 0, pendingBacklog: 2 })).toBe("");
    expect(formatPulseDirective({ activeRuns: 3, pendingBacklog: 5 })).toBe("");
  });

  it("computes cognitive telemetry from planning buffer and compiled tasks", () => {
    const stateEmpty: Record<string, unknown> = {};
    const telemetryEmpty = computeMindCognitiveTelemetry(stateEmpty);
    expect(telemetryEmpty.workSpan.total_work).toBe(0);
    expect(telemetryEmpty.activeAgents).toHaveLength(0);
    expect(telemetryEmpty.waveLanes).toHaveLength(0);

    const stateWithBuffer: Record<string, unknown> = {
      planning_buffer: [
        { id: "task-1", deps: [], effort: 2 },
        { id: "task-2", deps: ["task-1"], effort: 3 },
      ],
      agents: [
        {
          id: "agent-1",
          role: "implementer",
          host: "antigravity",
          status: "active",
          parent_task_id: "task-1",
        },
      ],
    };
    const telemetryBuffer = computeMindCognitiveTelemetry(stateWithBuffer);
    expect(telemetryBuffer.workSpan.total_work).toBe(5);
    expect(telemetryBuffer.workSpan.span).toBe(2);
    expect(telemetryBuffer.activeAgents).toHaveLength(1);
    expect(telemetryBuffer.activeAgents[0]?.agent_id).toBe("agent-1");
  });

  it("formats active and opened briefs adhering to format invariants", () => {
    const activeBrief = formatMindPulseActiveBrief({
      pulseId: "pulse-1",
      runRoot: "/test/run",
      actor: "mind-1",
      host: "antigravity",
      driver: "loop",
      openedAt: "2026-08-29T10:00:00.000Z",
      deadlineAt: "2026-08-29T10:20:00.000Z",
      scheduledIntervalMs: 900000,
      nextWakeAt: "2026-08-29T10:15:00.000Z",
      pulsesToday: 1,
      pulsesPerDay: 96,
      activeRuns: 0,
      pendingBacklog: 0,
    });
    expect(activeBrief).toContain("Mind Pulse Active: pulse-1");
    expect(activeBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(activeBrief).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");

    const openedBrief = formatMindPulseOpenedBrief({
      pulseId: "pulse-2",
      runRoot: "/test/run",
      actor: "mind-1",
      host: "antigravity",
      driver: "loop",
      openedAt: "2026-08-29T10:00:00.000Z",
      deadlineAt: "2026-08-29T10:20:00.000Z",
      scheduledIntervalMs: 900000,
      nextWakeAt: "2026-08-29T10:15:00.000Z",
      pulsesToday: 2,
      pulsesPerDay: 96,
      activeRuns: 1,
      pendingBacklog: 0,
    });
    expect(openedBrief).toContain("Mind Pulse Opened: pulse-2");
    expect(openedBrief).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    expect(openedBrief).not.toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
  });

  it("executes mindPulseCommand for opening and active telemetry cycles", async () => {
    const fixture = setupFixture("cmd-test");
    const openTime = "2026-08-29T10:00:00.000Z";
    const checkTime = "2026-08-29T10:05:00.000Z";

    const openedResult = await mindPulseCommand({
      run: fixture.run,
      actor: "mind-1",
      host: "antigravity",
      driver: "perpetual-loop",
      now: openTime,
    });

    expect(openedResult.status).toBe("opened");
    expect(openedResult.action).toBe("opened");
    expect(openedResult.pulse_id).toBe("pulse-1");
    expect(openedResult.closing_permitted).toBe(false);
    expect(openedResult.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);

    const activeResult = await mindPulseCommand({
      run: fixture.run,
      actor: "mind-1",
      now: checkTime,
    });

    expect(activeResult.status).toBe("active");
    expect(activeResult.action).toBe("telemetry");
    expect(activeResult.pulse_id).toBe("pulse-1");
    expect(activeResult.closing_permitted).toBe(false);
    expect(activeResult.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
  });
});
