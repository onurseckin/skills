import { describe, expect, it } from "bun:test";
import {
  formatMindPulseActiveBrief,
  formatPulseDirective,
} from "../../olt/scripts/src/cli/commands/mind-pulse-formatter.ts";

describe("pulse-parallel-directives", () => {
  it("emits parallel worktree dispatch directive when activeRuns > 0 and readyTasksCount > 0", () => {
    const directive = formatPulseDirective({
      activeRuns: 2,
      pendingBacklog: 5,
      readyTasksCount: 3,
    });

    expect(directive).toContain("PARALLEL WORKTREE DISPATCH REQUIRED");
    expect(directive).toContain("2 Active");
    expect(directive).toContain("3 Ready");
    expect(directive).toContain("5 total items pending");
    expect(directive).toContain("3 ready for immediate dispatch");
    expect(directive).toContain("worktree:create");
    expect(directive).toContain("Mobilize parallel lanes now");
  });

  it("emits ready task dispatch directive when activeRuns is 0 and readyTasksCount > 0", () => {
    const directive = formatPulseDirective({
      activeRuns: 0,
      pendingBacklog: 3,
      readyTasksCount: 2,
    });

    expect(directive).toContain("READY TASK DISPATCH REQUIRED");
    expect(directive).toContain("2 tasks waiting in ready state");
    expect(directive).toContain("Dispatch Tier 3 implementers via agent:register");
  });

  it("emits empty directive when activeRuns > 0 but readyTasksCount is 0 or undefined", () => {
    const directiveWithoutReady = formatPulseDirective({
      activeRuns: 2,
      pendingBacklog: 4,
    });
    expect(directiveWithoutReady).toBe("");

    const directiveWithZeroReady = formatPulseDirective({
      activeRuns: 1,
      pendingBacklog: 3,
      readyTasksCount: 0,
    });
    expect(directiveWithZeroReady).toBe("");
  });

  it("integrates parallel worktree dispatch directive into active pulse brief", () => {
    const brief = formatMindPulseActiveBrief({
      pulseId: "pulse-parallel-01",
      runRoot: "/tmp/capsule",
      actor: "mind-agent",
      host: "darwin",
      driver: "claude-code",
      openedAt: "2026-09-07T12:00:00.000Z",
      deadlineAt: "2026-09-07T12:30:00.000Z",
      scheduledIntervalMs: 60000,
      nextWakeAt: "2026-09-07T12:01:00.000Z",
      pulsesToday: 4,
      pulsesPerDay: 50,
      activeRuns: 1,
      pendingBacklog: 4,
      readyTasksCount: 2,
    });

    expect(brief).toContain("PARALLEL WORKTREE DISPATCH REQUIRED (1 Active, 2 Ready)");
    expect(brief).toContain("worktree:create");
  });
});
