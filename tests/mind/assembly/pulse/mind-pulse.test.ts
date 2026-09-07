import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as path from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as evidenceModule from "../../../../olt/scripts/src/mind/evidence/index.ts";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
  mindPulseCommand,
} from "../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import type { MindPulseBriefParams } from "../../../../olt/scripts/src/cli/commands/mind-pulse-formatter.ts";
import {
  cleanupVirtualMindFS,
  scratchRoot,
  setupVirtualMindFS,
} from "../../fixtures/mind-fixture.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

function createBriefParams(partial: Partial<MindPulseBriefParams> = {}): MindPulseBriefParams {
  return {
    pulseId: "pulse-test-100",
    runRoot: "/virtual/test-run",
    actor: "mind-1",
    host: "antigravity",
    driver: "perpetual-loop",
    openedAt: "2026-09-01T12:00:00.000Z",
    deadlineAt: "2026-09-01T12:15:00.000Z",
    scheduledIntervalMs: 900_000,
    nextWakeAt: "2026-09-01T12:15:00.000Z",
    pulsesToday: 5,
    pulsesPerDay: 50,
    ...partial,
  };
}

describe("Mind Assembly Pulse Command and Telemetry Suite", () => {
  let testDir: string;
  let vfs: VirtualMemoryFS;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("mind-pulse");
    vfs.mkdirSync(path.join(testDir, ".olt"), { recursive: true });
    vfs.mkdirSync(path.join(testDir, ".git"), { recursive: true });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    cleanupVirtualMindFS();
  });

  describe("Invariant Constant & Directive Formatting", () => {
    it("exports canonical CLOSING_FORBIDDEN_FOR_MIND invariant constant", () => {
      expect(CLOSING_FORBIDDEN_FOR_MIND).toBe("CLOSING_FORBIDDEN_FOR_MIND");
    });

    it("formats Mode A Autonomous Discovery directive when queue and active runs are empty", () => {
      const directive = formatPulseDirective({ activeRuns: 0, pendingBacklog: 0 });
      expect(directive).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
      expect(directive).toContain("ZERO-IDLE MANDATE");
      expect(directive).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    });

    it("formats Stagnation Mitigation directive when stagnation is detected", () => {
      const directive = formatPulseDirective({
        activeRuns: 1,
        pendingBacklog: 3,
        isStagnating: true,
        stagnationStreak: 4,
        stagnationReason: "Zero state transitions observed",
      });
      expect(directive).toContain("STAGNATION MITIGATION DIRECTIVE [STREAK 4]");
      expect(directive).toContain("Zero state transitions observed");
      expect(directive).toContain("CLOSING_FORBIDDEN_FOR_MIND");
    });

    it("formats Ready Task Dispatch directive when ready tasks exist without active workers", () => {
      const directive = formatPulseDirective({
        activeRuns: 0,
        pendingBacklog: 2,
        readyTasksCount: 5,
      });
      expect(directive).toContain("READY TASK DISPATCH REQUIRED");
      expect(directive).toContain("5 tasks waiting in ready state");
    });
  });

  describe("Cognitive Telemetry Computation", () => {
    it("computes default telemetry metrics on empty capsule state", () => {
      const telemetry = computeMindCognitiveTelemetry({});
      expect(telemetry.workSpan.total_work).toBe(0);
      expect(telemetry.workSpan.span).toBe(1);
      expect(telemetry.activeAgents).toHaveLength(0);
      expect(telemetry.waveLanes).toHaveLength(0);
    });

    it("extracts active agents, work spans, and waves from populated state graph", () => {
      const state: Record<string, unknown> = {
        graph: { nodes: [] },
        agents: [{ id: "agent-alpha", status: "active", role: "implementer", host: "antigravity" }],
        tasks: {
          taskA: {
            id: "taskA",
            status: "claimed",
            effort: 4,
            lease: { agent_id: "agent-alpha", role: "implementer" },
            dependencies: [],
          },
          taskB: {
            id: "taskB",
            status: "ready",
            effort: 2,
            dependencies: ["taskA"],
          },
        },
      };

      const telemetry = computeMindCognitiveTelemetry(state);
      expect(telemetry.workSpan.total_work).toBeGreaterThanOrEqual(6);
      expect(telemetry.activeAgents.length).toBeGreaterThanOrEqual(1);
      expect(telemetry.activeAgents[0]?.agent_id).toBe("agent-alpha");
      expect(telemetry.activeAgents[0]?.role).toBe("implementer");
      expect(telemetry.activeAgents[0]?.coordinate_badge).toBeDefined();
    });

    it("extracts wave lanes from planning_buffer when graph is uncompiled", () => {
      const state: Record<string, unknown> = {
        planning_buffer: [
          { id: "bufTask1", effort: 3, deps: [] },
          { id: "bufTask2", effort: 2, deps: ["bufTask1"] },
        ],
      };
      const telemetry = computeMindCognitiveTelemetry(state);
      expect(telemetry.workSpan.total_work).toBe(5);
      expect(telemetry.waveLanes.length).toBeGreaterThan(0);
    });
  });

  describe("Mind Pulse Brief Formatting", () => {
    it("formats active pulse brief with status, invariants, and budget headroom", () => {
      const brief = formatMindPulseActiveBrief(createBriefParams());
      expect(brief).toContain("Mind Pulse Active: pulse-test-100");
      expect(brief).toContain("active (perpetual)");
      expect(brief).toContain("infinite autonomous cadence (CLOSING_FORBIDDEN_FOR_MIND)");
      expect(brief).toContain("5 / 50 pulses today");
    });

    it("formats opened pulse brief with initial timing and metadata", () => {
      const brief = formatMindPulseOpenedBrief(createBriefParams({ pulsesPerDay: null }));
      expect(brief).toContain("Mind Pulse Opened: pulse-test-100");
      expect(brief).toContain("opened (perpetual)");
      expect(brief).toContain("5 / ∞ pulses today");
    });
  });

  describe("Command Guard and Authorization Enforcement", () => {
    it("throws HarnessError with INVALID_STATE when mind state is halted", async () => {
      const mockHaltedRun = {
        runRoot: testDir,
        state: {
          mind: {
            halted: true,
            halt_reason: "critical safety trip",
          },
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue(
          mockHaltedRun as unknown as ReturnType<typeof storeModule.loadRun>,
        ),
      );

      const commandPromise = mindPulseCommand({ run: testDir, actor: "mind-1" });
      expect(commandPromise).rejects.toThrow(HarnessError);
      expect(commandPromise).rejects.toThrow("critical safety trip");
    });

    it("throws HarnessError when actor holds no grant and is not an auto-granted role", async () => {
      const mockActiveRun = {
        runRoot: testDir,
        state: {
          mind: { halted: false },
          agents: [],
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue(
          mockActiveRun as unknown as ReturnType<typeof storeModule.loadRun>,
        ),
      );
      spies.push(
        spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
          hashChain: { valid: true },
          milestones: [],
        } as unknown as ReturnType<typeof evidenceModule.verifyMilestoneEvidence>),
      );

      const commandPromise = mindPulseCommand({
        run: testDir,
        actor: "unauthorized-external-actor",
      });
      expect(commandPromise).rejects.toThrow(HarnessError);
      expect(commandPromise).rejects.toThrow("holds no grant");
    });

    it("throws HarnessError with INVALID_STATE when actor holds non-mind role grant", async () => {
      const mockActiveRun = {
        runRoot: testDir,
        state: {
          mind: { halted: false },
          agents: [
            {
              id: "worker-agent",
              role: "implementer",
              status: "active",
              host: "antigravity",
              parent_agent_id: null,
              parent_task_id: null,
              granted_at: "2026-09-01T12:00:00.000Z",
            },
          ],
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue(
          mockActiveRun as unknown as ReturnType<typeof storeModule.loadRun>,
        ),
      );
      spies.push(
        spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
          hashChain: { valid: true },
          milestones: [],
        } as unknown as ReturnType<typeof evidenceModule.verifyMilestoneEvidence>),
      );

      const commandPromise = mindPulseCommand({ run: testDir, actor: "worker-agent" });
      expect(commandPromise).rejects.toThrow(HarnessError);
      expect(commandPromise).rejects.toThrow("role 'mind' is required");
    });

    it("permits canonical auto-grant actors without pre-existing agent ledger entry", async () => {
      const mockActiveRun = {
        runRoot: testDir,
        state: {
          mind: { halted: false },
          agents: [],
          pulse: {
            open: {
              pulse_id: "pulse-open-99",
              opened_at: "2026-09-01T12:00:00.000Z",
              deadline_at: "2026-09-01T12:15:00.000Z",
            },
          },
          budget: {
            pulses_per_day: 100,
            base_interval_ms: 900_000,
          },
        },
      };
      spies.push(
        spyOn(storeModule, "loadRun").mockReturnValue(
          mockActiveRun as unknown as ReturnType<typeof storeModule.loadRun>,
        ),
      );
      spies.push(
        spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
          hashChain: { valid: true },
          milestones: [],
        } as unknown as ReturnType<typeof evidenceModule.verifyMilestoneEvidence>),
      );

      const result = await mindPulseCommand({
        run: testDir,
        actor: "mind-1",
        now: "2026-09-01T12:05:00.000Z",
      });
      expect(result.status).toBe("active");
      expect(result.actor).toBe("mind-1");
      expect(result.closing_permitted).toBe(false);
      expect(result.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
    });
  });
});
