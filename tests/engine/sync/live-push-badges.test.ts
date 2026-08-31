import { describe, expect, it } from "bun:test";
import {
  generateAgentStatusBadge,
  generateAsciiDagBadges,
  generateQuotaBudgetBadge,
  generateSchedulerTelemetryBanner,
  generateStagnationBadge,
  generateTaskStateBadge,
  generateWaveLaneBadges,
  type AgentBadgeItem,
  type QuotaBudgetBadgeItem,
  type TaskBadgeItem,
  type WaveLaneBadgeItem,
} from "../../../olt/scripts/src/engine/scheduler/diagnostics/ascii-badges.ts";

describe("ASCII Telemetry Badge Generators", () => {
  it("generates task state badges with glyphs, wave/lane coordinates, and lease assignments", () => {
    const pendingTask: TaskBadgeItem = {
      id: "task-1",
      status: "ready",
      wave: 1,
      lane: 1,
    };
    const pendingBadge = generateTaskStateBadge(pendingTask);
    expect(pendingBadge).toContain("W1:L1");
    expect(pendingBadge).toContain("task-1");

    const leasedTask: TaskBadgeItem = {
      id: "task-2",
      status: "leased",
      wave: 1,
      lane: 2,
      assignedAgent: "impl-worker-1",
      role: "implementer",
    };
    const leasedBadge = generateTaskStateBadge(leasedTask);
    expect(leasedBadge).toContain("W1:L2");
    expect(leasedBadge).toContain("impl-worker-1 (implementer) @ task-2");

    const completedTask: TaskBadgeItem = {
      id: "task-3",
      status: "completed",
      wave: 2,
      lane: 1,
    };
    const completedBadge = generateTaskStateBadge(completedTask);
    expect(completedBadge).toContain("W2:L1");
    expect(completedBadge).toContain("task-3");
  });

  it("generates agent status badges for active and empty sets", () => {
    const emptyBadge = generateAgentStatusBadge([]);
    expect(emptyBadge).toBe("[🤖 Agents: 0 active]");

    const agents: AgentBadgeItem[] = [
      { id: "agent-1", role: "implementer", status: "active", task_id: "task-1" },
      { id: "agent-2", role: "validator", status: "active" },
      { id: "agent-3", role: "implementer", status: "idle" },
    ];
    const agentBadge = generateAgentStatusBadge(agents);
    expect(agentBadge).toContain("Agents (2)");
    expect(agentBadge).toContain("agent-1 (implementer @ task-1)");
    expect(agentBadge).toContain("agent-2 (validator)");
    expect(agentBadge).not.toContain("agent-3");
  });

  it("generates quota budget badges with pulses, wall-clock, and headroom telemetry", () => {
    const budget: QuotaBudgetBadgeItem = {
      pulsesToday: 14,
      pulsesPerDay: 50,
      remainingQuotaPercent: 72,
      wallClockMsToday: 180000,
      wallClockMsPerDay: 600000,
    };
    const badge = generateQuotaBudgetBadge(budget);
    expect(badge).toContain("14/50 pulses");
    expect(badge).toContain("72% headroom");
    expect(badge).toContain("3m/10m wall-clock");

    const unlimitedBudget: QuotaBudgetBadgeItem = {
      pulsesToday: 5,
      pulsesPerDay: null,
    };
    const unlimitedBadge = generateQuotaBudgetBadge(unlimitedBudget);
    expect(unlimitedBadge).toContain("5/∞ pulses");
  });

  it("generates wave and lane status badges with active execution markers", () => {
    const waveItems: WaveLaneBadgeItem[] = [
      { wave: 1, lane_count: 3, status: "completed", is_active: false },
      { wave: 2, lane_count: 2, status: "running", is_active: true },
      { wave: 3, lane_count: 4, status: "pending", is_active: false },
    ];
    const badges = generateWaveLaneBadges(waveItems);
    expect(badges.length).toBe(3);
    expect(badges[0]).toBe("[Wave 1: 3 lane(s) (completed)]");
    expect(badges[1]).toBe("[Wave 2: 2 lane(s) (running) ⚡]");
    expect(badges[2]).toBe("[Wave 3: 4 lane(s) (pending)]");
  });

  it("generates stagnation badges according to zero-value streak thresholds", () => {
    expect(generateStagnationBadge(0)).toBe("[✨ Flowing: active progress]");
    expect(generateStagnationBadge(1)).toBe("[⚠️ Idling: streak 1]");
    expect(generateStagnationBadge(2)).toBe("[⚠️ Idling: streak 2]");
    expect(generateStagnationBadge(3)).toBe("[🚨 Stagnation Warning: streak 3]");
    expect(generateStagnationBadge(1, true)).toBe("[🚨 Stagnation Warning: streak 1]");
  });

  it("assembles complete scheduler telemetry banner", () => {
    const banner = generateSchedulerTelemetryBanner({
      stagnationBadge: "[✨ Flowing: active progress]",
      quotaBadge: "[⏳ Quota: 10/50 pulses]",
      agentBadge: "[🤖 Agents (1): impl-1 (implementer)]",
      waveBadge: "[Wave 1: 2 lane(s) (running) ⚡]",
      dagBadges: ["[W1:L1 ⏳ task-1]", "[W1:L2 ⚡ task-2]"],
    });

    expect(banner).toContain("[✨ Flowing: active progress]");
    expect(banner).toContain("[⏳ Quota: 10/50 pulses]");
    expect(banner).toContain("[🤖 Agents (1): impl-1 (implementer)]");
    expect(banner).toContain("[Wave 1: 2 lane(s) (running) ⚡]");
    expect(banner).toContain("[W1:L1 ⏳ task-1] [W1:L2 ⚡ task-2]");
  });

  it("computes DAG badges automatically from arbitrary state graph", () => {
    const state = {
      tasks: {
        "task-1": { status: "completed", dependencies: [] },
        "task-2": { status: "ready", dependencies: ["task-1"] },
        "task-3": {
          status: "leased",
          dependencies: ["task-1"],
          lease: { agent_id: "worker-1", role: "implementer" },
        },
        "task-4": { status: "proposed", dependencies: ["task-2", "task-3"] },
      },
    };

    const badges = generateAsciiDagBadges(state);
    expect(badges.length).toBe(4);
    expect(badges[0]).toContain("task-1");
    expect(badges[1]).toContain("task-2");
    expect(badges[2]).toContain("worker-1");
    expect(badges[3]).toContain("task-4");
  });
});
