import { describe, expect, it } from "bun:test";
import {
  DEFICIT_CRITICALITY_CLASSES,
  formatDeficitTopologyMatrixMarkdown,
  inferSubsystemFromPath,
  type DeficitClusterNode,
  type DeficitTopologyMatrix,
} from "../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";

function createMockClusterNode(
  clusterId: string,
  classification: "CLASS_1_BLOCKER" | "CLASS_2_REGRESSION" | "CLASS_3_QUALITY_DEFICIT",
  cascading?: readonly string[],
): DeficitClusterNode {
  return {
    clusterId,
    rootCauseTitle: `Root Cause for ${clusterId}`,
    classification: DEFICIT_CRITICALITY_CLASSES[classification],
    severityScore:
      classification === "CLASS_1_BLOCKER"
        ? 9.0
        : classification === "CLASS_2_REGRESSION"
          ? 6.0
          : 2.0,
    affectedFiles: ["src/mind/core/state.ts", "src/mind/planning/engine.ts"],
    affectedSubsystems: ["mind/core", "mind/planning"],
    rawOccurrenceCount: 4,
    representativeError: {
      id: `err-${clusterId}`,
      kind: "typescript_compilation",
      classification: DEFICIT_CRITICALITY_CLASSES[classification],
      message: "TS2304: Cannot find name 'StateStore'",
      normalizedMessage: "cannot find name statestore",
      filePath: "src/mind/core/state.ts",
      subsystem: "mind/core",
      timestamp: new Date().toISOString(),
    },
    stackTraceSignature: "SIG-STK-12345",
    rootCauseHypothesis: "Missing export in core barrel module",
    suggestedRemediationAction: "Export StateStore from src/mind/core/index.ts",
    priorityRank: 1,
    errorCodes: ["TS2304"],
    primarySubsystem: "mind/core",
    cascadingDownstreamClusters: cascading,
    firstObservedAt: new Date().toISOString(),
    lastObservedAt: new Date().toISOString(),
    sampleErrorSnippets: [
      "src/mind/core/state.ts:10:5 error TS2304: Cannot find name 'StateStore'",
    ],
  };
}

describe("Diagnostic Clustering Synthesis and Markdown Formatting Edge Coverage", () => {
  it("formats Markdown with Class 1 Blocker caution alerts, cascades, and snippets", () => {
    const cluster = createMockClusterNode("CLUSTER-B1", "CLASS_1_BLOCKER", [
      "CLUSTER-R1",
      "CLUSTER-Q1",
    ]);
    const matrix: DeficitTopologyMatrix = {
      matrixId: "TOPO-BLOCKER",
      generatedAt: new Date().toISOString(),
      totalRawErrors: 4,
      totalClusters: 1,
      summary: {
        blockers: 1,
        regressions: 0,
        qualityDeficits: 0,
        totalRawErrors: 4,
        totalClusters: 1,
        compositeFrictionScore: 0.9,
        criticalSubsystems: ["mind/core"],
        healthStatus: "CRITICAL",
      },
      clusters: [cluster],
      subsystemHealthScores: {
        "mind/core": 0.45,
        "mind/planning": 0.75,
        "system/core": 0.95,
      },
      recommendedRoadmapAllocation: {
        coreStability: 90,
        architecturalEvolution: 10,
        exploratory: 0,
        rationale: "Emergency blocker remediation",
      },
    };

    const md = formatDeficitTopologyMatrixMarkdown(matrix);
    expect(md).toContain("> [!CAUTION]");
    expect(md).toContain("CLASS 1 BLOCKER CLUSTER(S) DETECTED");
    expect(md).toContain("🔴 Class 1 Blocker");
    expect(md).toContain("Cascading Downstream Clusters");
    expect(md).toContain("🔴 CRITICAL");
    expect(md).toContain("🟡 DEGRADED");
    expect(md).toContain("🟢 HEALTHY");
  });

  it("formats Markdown with Class 2 Regression warning and Class 3 Quality note alerts", () => {
    const regCluster = createMockClusterNode("CLUSTER-R1", "CLASS_2_REGRESSION");
    const matrixReg: DeficitTopologyMatrix = {
      matrixId: "TOPO-REG",
      generatedAt: new Date().toISOString(),
      totalRawErrors: 2,
      totalClusters: 1,
      summary: {
        blockers: 0,
        regressions: 1,
        qualityDeficits: 0,
        totalRawErrors: 2,
        totalClusters: 1,
        compositeFrictionScore: 0.6,
        criticalSubsystems: [],
        healthStatus: "DEGRADED",
      },
      clusters: [regCluster],
      subsystemHealthScores: { "mind/core": 0.8 },
      recommendedRoadmapAllocation: {
        coreStability: 80,
        architecturalEvolution: 15,
        exploratory: 5,
        rationale: "Regression remediation",
      },
    };

    const mdReg = formatDeficitTopologyMatrixMarkdown(matrixReg);
    expect(mdReg).toContain("> [!WARNING]");
    expect(mdReg).toContain("CLASS 2 REGRESSION CLUSTER(S) DETECTED");

    const qualCluster = createMockClusterNode("CLUSTER-Q1", "CLASS_3_QUALITY_DEFICIT");
    const matrixQual: DeficitTopologyMatrix = {
      matrixId: "TOPO-QUAL",
      generatedAt: new Date().toISOString(),
      totalRawErrors: 1,
      totalClusters: 1,
      summary: {
        blockers: 0,
        regressions: 0,
        qualityDeficits: 1,
        totalRawErrors: 1,
        totalClusters: 1,
        compositeFrictionScore: 0.2,
        criticalSubsystems: [],
        healthStatus: "HEALTHY",
      },
      clusters: [qualCluster],
      subsystemHealthScores: { "mind/core": 0.95 },
      recommendedRoadmapAllocation: {
        coreStability: 70,
        architecturalEvolution: 20,
        exploratory: 10,
        rationale: "Nominal allocation",
      },
    };

    const mdQual = formatDeficitTopologyMatrixMarkdown(matrixQual);
    expect(mdQual).toContain("> [!NOTE]");
    expect(mdQual).toContain("CLASS 3 QUALITY DEFICIT(S)");
  });

  it("infers canonical subsystems from diverse path formats and message heuristics", () => {
    expect(inferSubsystemFromPath("olt/scripts/src/mind/planning/engine.ts")).toBe("mind/planning");
    expect(inferSubsystemFromPath("src/auth/tokens/jwt.ts")).toBe("auth/tokens");
    expect(inferSubsystemFromPath("src/bootstrap.ts")).toBe("system/core");
    expect(inferSubsystemFromPath("packages/compiler/main.ts")).toBe("packages/compiler");
    expect(inferSubsystemFromPath("system/utils.ts")).toBe("system");
    expect(inferSubsystemFromPath("root.ts")).toBe("system/core");
    expect(inferSubsystemFromPath(undefined, "Invariant violation inside crucible protocol")).toBe(
      "mind/crucible",
    );
    expect(inferSubsystemFromPath(undefined, "Generic unclassified error")).toBe("system/core");
    expect(inferSubsystemFromPath("", "")).toBe("system/core");
  });
});
