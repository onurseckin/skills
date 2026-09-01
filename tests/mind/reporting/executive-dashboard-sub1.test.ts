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

  describe("Initial Dashboard State Factory & Data Integrity", () => {
    it("creates initial dashboard state conforming to schema with all 5 mandatory sections", () => {
      const state = createInitialDashboardState({
        runId: "test-run-42",
        activeMode: "Perpetual Sovereign Execution",
        systemicHealthScore: 0.985,
        healthStatus: "nominal",
        uptimeSeconds: 7200,
        activeGeneration: 4,
        currentPulseIndex: 108,
        memoryTokens: 30000,
        memoryTokenLimit: 128000,
      });

      expect(state.schemaVersion).toBe("1.0.0");
      expect(state.runId).toBe("test-run-42");
      expect(state.trajectory.activeMode).toBe("Perpetual Sovereign Execution");
      expect(state.trajectory.systemicHealthScore).toBe(0.985);
      expect(state.trajectory.healthStatus).toBe("nominal");
      expect(state.trajectory.autonomousUptime).toBe("2h 0m 0s");
      expect(state.trajectory.autonomousUptimeSeconds).toBe(7200);
      expect(state.trajectory.currentPulseIndex).toBe(108);
      expect(state.trajectory.activeGeneration).toBe(4);
      expect(state.trajectory.memoryTokenLoad.currentTokens).toBe(30000);
      expect(state.trajectory.roadmapExpansionLocked).toBe(false);

      // Verify all 5 mandatory sections exist
      expect(state.trajectory).toBeDefined();
      expect(state.portfolio).toBeDefined();
      expect(state.pareto).toBeDefined();
      expect(state.productCraft).toBeDefined();
      expect(state.roadmap).toBeDefined();
    });

    it("formats uptime and calculates roadmap progress correctly", () => {
      expect(calculateUptimeString(45)).toBe("45s");
      expect(calculateUptimeString(150)).toBe("2m 30s");
      expect(calculateUptimeString(3665)).toBe("1h 1m 5s");

      const sampleTasks: readonly RoadmapDeliverableTask[] = [
        {
          id: "T1",
          title: "Task 1",
          track: "TRACK_A",
          status: "COMPLETED",
          completionPercentage: 100,
        },
        {
          id: "T2",
          title: "Task 2",
          track: "TRACK_A",
          status: "IN_PROGRESS",
          completionPercentage: 50,
        },
      ];
      expect(computeTrackCompletion(sampleTasks)).toBe(75);

      const tracks = {
        trackA: {
          name: "Track A",
          deliverables: sampleTasks,
          completionPercentage: 75,
        },
        trackB: {
          name: "Track B",
          deliverables: [
            {
              id: "T3",
              title: "Task 3",
              track: "TRACK_B" as const,
              status: "COMPLETED" as const,
              completionPercentage: 100,
            },
          ],
          completionPercentage: 100,
        },
        trackC: {
          name: "Track C",
          deliverables: [],
          completionPercentage: 100,
        },
      };

      const progress = computeOverallRoadmapProgress(tracks);
      expect(progress.totalDeliverablesCount).toBe(3);
      expect(progress.completedDeliverablesCount).toBe(2);
      expect(progress.activeDeliverablesCount).toBe(1);
      expect(progress.overallCompletionPercentage).toBe(83.3);
    });
  });

  describe("Markdown Dashboard Rendering for 5 Mandatory Sections", () => {
    it("renders all 5 mandatory sections in high-fidelity markdown format", () => {
      const state = createInitialDashboardState({
        runId: "test-run-render",
        activeMode: "Perpetual Sovereign Execution",
        systemicHealthScore: 0.985,
        healthStatus: "nominal",
        uptimeSeconds: 7200,
        activeGeneration: 4,
        currentPulseIndex: 108,
      });

      const markdown = renderDashboardMarkdown(state);

      // Validate 5 Section Headers
      expect(markdown).toContain("# 🏛️ Mind Executive Briefing Dashboard");
      expect(markdown).toContain("## 1. ⏱️ Executive Runtime Trajectory");
      expect(markdown).toContain("## 2. ⚖️ Innovation Portfolio Balance (70 / 20 / 10)");
      expect(markdown).toContain("## 3. 🛡️ Settled Pareto Arbitrations & Bedrock Invariants");
      expect(markdown).toContain("## 4. 🎨 Creative Product Craft & User Delight Status");
      expect(markdown).toContain("## 5. 🗺️ In-Flight Roadmap & Active Deliverables");

      // Section 1: Runtime Trajectory details
      expect(markdown).toContain("Perpetual Sovereign Execution");
      expect(markdown).toContain("98.5%");
      expect(markdown).toContain("2h 0m 0s");
      expect(markdown).toContain("Pulse #108");

      // Section 2: Innovation Portfolio Balance (70/20/10)
      expect(markdown).toContain("Track A: Core Stability & Polish");
      expect(markdown).toContain("Track B: Architectural Evolution");
      expect(markdown).toContain("Track C: Exploratory Horizon Bets");
      expect(markdown).toContain("70%");
      expect(markdown).toContain("20%");
      expect(markdown).toContain("10%");

      // Section 3: Pareto Arbitrations & Bedrock Invariants
      expect(markdown).toContain("PARETO-001");
      expect(markdown).toContain("AXIOM-001");
      expect(markdown).toContain("AXIOM-002");

      // Section 4: Creative Product Craft & 5 Pillars
      expect(markdown).toContain("VISUAL_HIERARCHY");
      expect(markdown).toContain("LAYOUT_FLUIDITY");
      expect(markdown).toContain("TACTILE_MICRO_INTERACTIONS");
      expect(markdown).toContain("INTUITIVE_ONBOARDING");
      expect(markdown).toContain("EMOTIONAL_RESONANCE");
      expect(markdown).toContain("11.4 ms");

      // Section 5: Roadmap & Active Deliverables
      expect(markdown).toContain("TASK-4.1");
      expect(markdown).toContain("TASK-3.1");
      expect(markdown).toContain("BET-01");
    });
  });
});
