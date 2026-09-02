import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateUptimeString,
  computeOverallRoadmapProgress,
  computeTrackCompletion,
  createInitialDashboardState,
  ExecutiveDashboardEngine,
  readDashboardState,
  readDashboardStateSync,
  resolveDashboardPaths,
  updateDashboardSection,
  writeDashboardFilesSync,
} from "../../../olt/scripts/src/mind/reporting/executive-dashboard.ts";

const deliv = (
  id: string,
  track: "TRACK_A" | "TRACK_B" | "TRACK_C",
  status: "COMPLETED" | "IN_PROGRESS" | "GRADUATED" | "BLOCKED" | "TERMINATED",
  completionPercentage: number,
) => ({ id, title: id, track, status, completionPercentage });

describe("Executive Dashboard Coverage Suite", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dash-cov-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calculates uptime strings and path resolutions correctly", () => {
    expect(calculateUptimeString(-5)).toBe("0s");
    expect(calculateUptimeString(45)).toBe("45s");
    expect(calculateUptimeString(125)).toBe("2m 5s");
    expect(calculateUptimeString(3665)).toBe("1h 1m 5s");

    expect(resolveDashboardPaths().oltDir).toContain(".olt");
    expect(resolveDashboardPaths(tmpDir).oltDir).toBe(join(tmpDir, ".olt"));
    expect(resolveDashboardPaths(join(tmpDir, ".olt")).oltDir).toBe(join(tmpDir, ".olt"));
  });

  it("computes track completion and overall roadmap progress accurately", () => {
    expect(computeTrackCompletion([])).toBe(100);
    const delivs = [
      deliv("1", "TRACK_A", "COMPLETED", 100),
      deliv("2", "TRACK_A", "IN_PROGRESS", 50),
    ];
    expect(computeTrackCompletion(delivs)).toBe(75);

    const empty = computeOverallRoadmapProgress({
      trackA: { name: "A", deliverables: [], completionPercentage: 100 },
      trackB: { name: "B", deliverables: [], completionPercentage: 100 },
      trackC: { name: "C", deliverables: [], completionPercentage: 100 },
    });
    expect(empty.overallCompletionPercentage).toBe(100);

    const full = computeOverallRoadmapProgress({
      trackA: { name: "A", deliverables: delivs, completionPercentage: 75 },
      trackB: {
        name: "B",
        deliverables: [
          deliv("3", "TRACK_B", "GRADUATED", 100),
          deliv("4", "TRACK_B", "BLOCKED", 10),
        ],
        completionPercentage: 55,
      },
      trackC: {
        name: "C",
        deliverables: [deliv("5", "TRACK_C", "TERMINATED", 0)],
        completionPercentage: 0,
      },
    });
    expect(full.totalDeliverablesCount).toBe(5);
    expect(full.completedDeliverablesCount).toBe(2);
    expect(full.activeDeliverablesCount).toBe(1);
    expect(full.overallCompletionPercentage).toBe(52);
  });

  it("handles initial dashboard state factory branches and options", () => {
    const defaultState = createInitialDashboardState();
    expect(defaultState.trajectory.healthStatus).toBe("nominal");
    expect(defaultState.trajectory.roadmapExpansionLocked).toBe(false);

    const degraded = createInitialDashboardState({
      systemicHealthScore: 0.75,
      uptimeSeconds: 3600,
    });
    expect(degraded.trajectory.healthStatus).toBe("degraded");
    expect(degraded.trajectory.roadmapExpansionLocked).toBe(true);

    const critical = createInitialDashboardState({
      systemicHealthScore: 0.4,
      healthStatus: "critical",
    });
    expect(critical.trajectory.healthStatus).toBe("critical");
    expect(critical.trajectory.roadmapExpansionLocked).toBe(true);
  });

  it("renders markdown across all badge and status variants", () => {
    const engine = new ExecutiveDashboardEngine();
    engine.updateTrajectory({ healthStatus: "critical", roadmapExpansionLocked: true });
    engine.updatePortfolio({
      balanceStatus: "TIMIDITY_TRAP",
      rebalanceRecommendations: [
        { fromTrack: "A", toTrack: "C", shiftPercent: 10, rationale: "Shift", urgency: "HIGH" },
      ],
    });
    engine.recordProductCraftAudit({
      compositeScore: 60,
      passThreshold: 80,
      openDeficits: {
        blockingCount: 1,
        majorCount: 1,
        minorCount: 0,
        totalOpen: 2,
        notices: [
          {
            id: "D1",
            milestoneId: "M1",
            pillar: "VISUAL",
            severity: "BLOCKING",
            description: "Deficit",
            remediation: "Fix",
          },
        ],
      },
    });
    engine.recordDeliverable(deliv("T-BLOCKED", "TRACK_A", "BLOCKED", 10));
    engine.recordDeliverable(deliv("T-GRAD", "TRACK_C", "GRADUATED", 100));
    engine.recordDeliverable(deliv("T-TERM", "TRACK_C", "TERMINATED", 0));

    const md = engine.renderMarkdown();
    expect(md).toContain("🔴 CRITICAL");
    expect(md).toContain("⚠️ TIMIDITY TRAP");
    expect(md).toContain("❌ DEFICIT NOTICE");
    expect(md).toContain("🔒 LOCKED");
    expect(md).toContain("Active Rebalance Directives");
    expect(md).toContain("Open Aesthetic Deficit Notices");
    expect(md).toContain("🎓 GRADUATED");
    expect(md).toContain("🛑 RECORDED");
  });

  it("executes async and sync file operations and partial section updates", async () => {
    const state = createInitialDashboardState();
    expect(readDashboardStateSync(tmpDir)).toBeNull();
    expect(await readDashboardState(tmpDir)).toBeNull();

    writeDashboardFilesSync(state, tmpDir);
    expect(readDashboardStateSync(tmpDir)?.dashboardId).toBe(state.dashboardId);

    const updated = await updateDashboardSection(tmpDir, {
      trajectory: { ...state.trajectory, activeMode: "DIALECTIC" },
    });
    expect(updated.trajectory.activeMode).toBe("DIALECTIC");
    expect((await readDashboardState(tmpDir))?.trajectory.activeMode).toBe("DIALECTIC");
  });

  it("exercises all ExecutiveDashboardEngine lifecycle mutations and edge cases", async () => {
    const engine = new ExecutiveDashboardEngine(undefined, tmpDir);
    expect(engine.getState().schemaVersion).toBe("1.0.0");

    engine.updateTrajectory({ autonomousUptimeSeconds: 7200 });
    expect(engine.getState().trajectory.autonomousUptime).toBe("2h 0m 0s");
    engine.updatePortfolio({ totalWorkstreams: 12 });
    expect(engine.getState().portfolio.totalWorkstreams).toBe(12);

    engine.recordParetoDecision({
      id: "DEC-1",
      topic: "Arbitration",
      winningApproach: "A",
      chosenPriorityLevel: 1,
      priorityName: "P1",
      rationale: "R",
      arbitratedAt: new Date().toISOString(),
    });
    expect(engine.getState().pareto.totalArbitrationsCount).toBe(3);

    engine.recordBedrockInvariant({
      id: "INV-C",
      name: "Axiom",
      statement: "Mandate",
      domain: "Core",
      lockedAt: new Date().toISOString(),
    });
    expect(engine.getState().pareto.lockedBedrockInvariants.some((i) => i.id === "INV-C")).toBe(
      true,
    );

    engine.recordProductCraftAudit({
      compositeScore: 78,
      passThreshold: 80,
      openDeficits: { blockingCount: 0, majorCount: 0, minorCount: 0, totalOpen: 0 },
    });
    expect(engine.getState().productCraft.ergonomicWalkthroughStatus).toBe("PENDING");

    engine.recordDeliverable(deliv("T-A", "TRACK_A", "IN_PROGRESS", 50));
    engine.recordDeliverable(deliv("T-B", "TRACK_B", "IN_PROGRESS", 40));
    engine.recordDeliverable(deliv("T-C", "TRACK_C", "IN_PROGRESS", 30));

    engine.updateDeliverableStatus("T-A", "COMPLETED", 100, "Done now");
    expect(
      engine.getState().roadmap.tracks.trackA.deliverables.find((d) => d.id === "T-A")?.status,
    ).toBe("COMPLETED");

    const beforeState = engine.getState();
    engine.updateDeliverableStatus("NON-EXISTENT", "COMPLETED");
    expect(engine.getState()).toBe(beforeState);

    expect(engine.renderMarkdown()).toContain("# 🏛️ Mind Executive Briefing Dashboard");
    expect(JSON.parse(engine.exportJson()).schemaVersion).toBe("1.0.0");
    expect(engine.saveToDiskSync().mdPath).toContain("executive-dashboard.md");
    expect((await engine.saveToDisk()).jsonPath).toContain("dashboard.json");
  });
});
