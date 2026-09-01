import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutiveDashboardEngine,
  createInitialDashboardState,
  renderDashboardMarkdown,
  writeDashboardFiles,
  writeDashboardFilesSync,
  readDashboardState,
  readDashboardStateSync,
  updateDashboardSection,
  calculateUptimeString,
  computeTrackCompletion,
  computeOverallRoadmapProgress,
  CANONICAL_BEDROCK_INVARIANTS,
  DEFAULT_PRODUCT_CRAFT_PILLARS,
  type ExecutiveDashboardState,
  type ParetoArbitrationDecisionRecord,
  type BedrockInvariantRecord,
  type RoadmapDeliverableTask,
} from "../../../olt/scripts/src/mind/reporting/index.ts";

describe("Live Executive Briefing Dashboard Suite", () => {
  let tempRepo: string;

  beforeEach(() => {
    tempRepo = mkdtempSync(join(tmpdir(), "mind-dashboard-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRepo, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("ExecutiveDashboardEngine Interactive Update Operations", () => {
    it("updates trajectory, records pareto decisions, bedrock invariants, product craft audits, and deliverables", () => {
      const engine = new ExecutiveDashboardEngine();
      expect(engine.getState().schemaVersion).toBe("1.0.0");

      // Update Trajectory
      engine.updateTrajectory({
        autonomousUptimeSeconds: 18000,
        systemicHealthScore: 0.992,
        healthStatus: "nominal",
        currentPulseIndex: 120,
      });
      const updatedTrajectory = engine.getState().trajectory;
      expect(updatedTrajectory.autonomousUptime).toBe("5h 0m 0s");
      expect(updatedTrajectory.systemicHealthScore).toBe(0.992);
      expect(updatedTrajectory.currentPulseIndex).toBe(120);

      // Record Pareto Decision
      const newDecision: ParetoArbitrationDecisionRecord = {
        id: "PARETO-003",
        topic: "Continuous Preplanner Ingestion Performance",
        winningApproach: "Single-pass streaming parse (Priority 2: Cognitive Simplicity)",
        losingApproach: "Multi-layered regex parser (Priority 4: Speculative Abstraction)",
        chosenPriorityLevel: 2,
        priorityName: "Priority 2: Cognitive Simplicity & Architectural Maintainability",
        empiricalDelta: "+55% Speedup with 0 dependencies",
        rationale:
          "Unconditionally beats complex multi-layer abstractions with negligible cognitive footprint.",
        arbitratedAt: new Date().toISOString(),
      };

      engine.recordParetoDecision(newDecision);
      expect(engine.getState().pareto.recentArbitrations[0]?.id).toBe("PARETO-003");
      expect(engine.getState().pareto.totalArbitrationsCount).toBe(3);

      // Record Bedrock Invariant
      const newInvariant: BedrockInvariantRecord = {
        id: "AXIOM-006",
        name: "Non-Disruptive Observability Invariant",
        statement:
          "Dashboard updates must never interrupt active agent threads or block sovereign execution loops.",
        domain: "Observability",
        lockedAt: new Date().toISOString(),
      };

      engine.recordBedrockInvariant(newInvariant);
      const foundInvariant = engine
        .getState()
        .pareto.lockedBedrockInvariants.find((i) => i.id === "AXIOM-006");
      expect(foundInvariant).toBeDefined();

      // Record Product Craft Audit
      engine.recordProductCraftAudit({
        compositeScore: 96.8,
        passThreshold: 85.0,
        microInteractionLatencyMs: 9.8,
        openDeficits: {
          blockingCount: 0,
          majorCount: 0,
          minorCount: 1,
          totalOpen: 1,
          notices: [
            {
              id: "DEFICIT-001",
              milestoneId: "MS-4",
              pillar: "LAYOUT_FLUIDITY",
              severity: "MINOR",
              description: "Slight 2px padding misalignment on narrow viewport",
              remediation: "Apply responsive token padding classes",
            },
          ],
        },
      });

      const updatedCraft = engine.getState().productCraft;
      expect(updatedCraft.compositeCraftScore).toBe(96.8);
      expect(updatedCraft.microInteractionLatencyMs).toBe(9.8);
      expect(updatedCraft.passed).toBe(true);
      expect(updatedCraft.openDeficits.totalOpen).toBe(1);

      // Record and Update Deliverable
      const newTask: RoadmapDeliverableTask = {
        id: "TASK-4.3",
        title: "Continuous Executive Reporting Automation",
        track: "TRACK_A",
        status: "IN_PROGRESS",
        completionPercentage: 70,
        owner: "mind-implementer",
        notes: "Automated cron heartbeat integration",
      };

      engine.recordDeliverable(newTask);
      const foundTask = engine
        .getState()
        .roadmap.tracks.trackA.deliverables.find((d) => d.id === "TASK-4.3");
      expect(foundTask).toBeDefined();

      engine.updateDeliverableStatus("TASK-4.3", "COMPLETED", 100, "Shipped with tests");
      const completedTask = engine
        .getState()
        .roadmap.tracks.trackA.deliverables.find((d) => d.id === "TASK-4.3");
      expect(completedTask?.status).toBe("COMPLETED");
      expect(completedTask?.completionPercentage).toBe(100);
    });
  });

  describe("Asynchronous & Synchronous File I/O Persistence", () => {
    it("writes and reads executive-dashboard.md and dashboard.json without disrupting execution", async () => {
      const engine = new ExecutiveDashboardEngine(undefined, tempRepo);

      // Asynchronous write & read
      const fileResult = await writeDashboardFiles(engine.getState(), tempRepo);
      expect(existsSync(fileResult.mdPath)).toBe(true);
      expect(existsSync(fileResult.jsonPath)).toBe(true);

      const loadedState = await readDashboardState(tempRepo);
      expect(loadedState).not.toBeNull();
      expect(loadedState?.schemaVersion).toBe("1.0.0");
      expect(loadedState?.trajectory.systemicHealthScore).toBeDefined();

      // Synchronous write & read
      const syncResult = writeDashboardFilesSync(engine.getState(), tempRepo);
      expect(existsSync(syncResult.mdPath)).toBe(true);
      expect(existsSync(syncResult.jsonPath)).toBe(true);

      const syncLoadedState = readDashboardStateSync(tempRepo);
      expect(syncLoadedState).not.toBeNull();
      expect(syncLoadedState?.trajectory.activeMode).toBeDefined();

      // Partial section update
      const partiallyUpdated = await updateDashboardSection(tempRepo, {
        trajectory: {
          ...loadedState!.trajectory,
          currentPulseIndex: 999,
          activeMode: "Autonomous Sovereign Orchestration",
        },
      });

      expect(partiallyUpdated.trajectory.currentPulseIndex).toBe(999);
      expect(partiallyUpdated.trajectory.activeMode).toBe("Autonomous Sovereign Orchestration");

      const reloaded = await readDashboardState(tempRepo);
      expect(reloaded?.trajectory.currentPulseIndex).toBe(999);

      // Engine saveToDisk and saveToDiskSync
      const engineWithRoot = new ExecutiveDashboardEngine(engine.getState(), tempRepo);
      const savedAsync = await engineWithRoot.saveToDisk();
      expect(existsSync(savedAsync.mdPath)).toBe(true);

      const savedSync = engineWithRoot.saveToDiskSync();
      expect(existsSync(savedSync.jsonPath)).toBe(true);
    });
  });
});
