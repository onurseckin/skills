import { describe, expect, it } from "bun:test";
import {
  DiagnosticClusteringEngine,
  type DeficitTopologyMatrix,
  type ParsedDiagnosticError,
} from "../../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";

function createMockMatrix(matrixId: string): DeficitTopologyMatrix {
  return {
    matrixId,
    generatedAt: new Date().toISOString(),
    totalRawErrors: 0,
    totalClusters: 0,
    summary: {
      blockers: 0,
      regressions: 0,
      qualityDeficits: 0,
      totalRawErrors: 0,
      totalClusters: 0,
      compositeFrictionScore: 0,
      criticalSubsystems: [],
      healthStatus: "HEALTHY",
    },
    clusters: [],
    subsystemHealthScores: { "mind/core": 1.0 },
    recommendedRoadmapAllocation: {
      coreStability: 70,
      architecturalEvolution: 20,
      exploratory: 10,
      rationale: "Nominal operational baseline",
    },
  };
}

describe("DiagnosticClusteringEngine Orchestrator Edge Coverage", () => {
  it("initializes with configuration and parses raw logs and structured inputs", () => {
    const engine = new DiagnosticClusteringEngine({
      defaultCwd: "/workspace",
      repoRoot: "/workspace",
      defaultTimeoutMs: 5000,
      similarityThreshold: 0.8,
      knownSubsystems: ["mind/core", "mind/planning"],
    });

    const parsedString = engine.parse(
      "src/mind/core/state.ts(12,5): error TS2304: Cannot find name 'foo'.",
    );
    expect(parsedString).toHaveLength(1);
    expect(parsedString[0]?.subsystem).toBe("mind/core");

    const parsedStructured = engine.parse({
      structuredErrors: [
        {
          filePath: "src/mind/planning/engine.ts",
          line: 45,
          column: 10,
          code: "TS2322",
          message: "Type 'number' is not assignable to type 'string'.",
        },
      ],
      sourceProbe: "custom-typecheck",
    });
    expect(parsedStructured).toHaveLength(1);
    expect(parsedStructured[0]?.sourceProbe).toBe("custom-typecheck");
  });

  it("clusters errors with ranking across classifications, severities, and occurrence counts", () => {
    const engine = new DiagnosticClusteringEngine();
    const mockErrors: ParsedDiagnosticError[] = [
      {
        id: "err-blocker",
        kind: "typescript_compilation",
        classification: "CLASS_1_BLOCKER",
        errorCode: "TS2304",
        message: "Cannot find name 'bar'",
        normalizedMessage: "cannot find name bar",
        filePath: "src/mind/core/bar.ts",
        subsystem: "mind/core",
        timestamp: new Date().toISOString(),
      },
      {
        id: "err-regression-1",
        kind: "test_assertion_failure",
        classification: "CLASS_2_REGRESSION",
        errorCode: "ASSERT_FAIL",
        message: "Expected 1 to be 2",
        normalizedMessage: "expected 1 to be 2",
        filePath: "src/mind/core/calc.ts",
        subsystem: "mind/core",
        timestamp: new Date().toISOString(),
      },
      {
        id: "err-regression-2",
        kind: "test_assertion_failure",
        classification: "CLASS_2_REGRESSION",
        errorCode: "ASSERT_FAIL_2",
        message: "Invariant failed",
        normalizedMessage: "invariant failed",
        filePath: "src/mind/planning/inv.ts",
        subsystem: "mind/planning",
        timestamp: new Date().toISOString(),
      },
      {
        id: "err-quality",
        kind: "lint_warning",
        classification: "CLASS_3_QUALITY_DEFICIT",
        errorCode: "no-unused-vars",
        message: "'x' is defined but never used",
        normalizedMessage: "x is defined but never used",
        filePath: "src/mind/core/unused.ts",
        subsystem: "mind/core",
        timestamp: new Date().toISOString(),
      },
    ];

    const matrix = engine.cluster(mockErrors, { matrixId: "TOPO-RANKED-TEST" });
    expect(matrix.matrixId).toBe("TOPO-RANKED-TEST");
    expect(matrix.totalClusters).toBeGreaterThanOrEqual(3);
    expect(matrix.clusters[0]?.classification).toBe("CLASS_1_BLOCKER");
    expect(engine.getLatestMatrix()?.matrixId).toBe("TOPO-RANKED-TEST");
    expect(engine.getHistory()).toHaveLength(1);
  });

  it("formats Markdown with fallback message when no matrix exists", () => {
    const engine = new DiagnosticClusteringEngine();
    const fallbackMsg = engine.formatMarkdown();
    expect(fallbackMsg).toContain("No Deficit Topology Matrix Available");

    const explicitMatrix = createMockMatrix("TOPO-EXPLICIT");
    const formattedExplicit = engine.formatMarkdown(explicitMatrix);
    expect(formattedExplicit).toContain("TOPO-EXPLICIT");

    engine.recordMatrix(explicitMatrix);
    const formattedLatest = engine.formatMarkdown();
    expect(formattedLatest).toContain("TOPO-EXPLICIT");
  });

  it("enforces history size cap of 50 matrices and clears history on demand", () => {
    const engine = new DiagnosticClusteringEngine();
    for (let i = 1; i <= 55; i++) {
      engine.recordMatrix(createMockMatrix(`TOPO-RUN-${i}`));
    }

    const history = engine.getHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.matrixId).toBe("TOPO-RUN-6");
    expect(history[49]?.matrixId).toBe("TOPO-RUN-55");
    expect(engine.getLatestMatrix()?.matrixId).toBe("TOPO-RUN-55");

    engine.clearHistory();
    expect(engine.getHistory()).toHaveLength(0);
    expect(engine.getLatestMatrix()).toBeUndefined();
  });

  it("executes simulated probe runs and automatically updates latest matrix", async () => {
    const engine = new DiagnosticClusteringEngine({
      defaultCwd: "/workspace",
    });

    const result = await engine.runProbes({
      simulate: true,
      simulatedOutputs: {
        typecheck: {
          exitCode: 0,
          stdout: "Found 0 errors.",
          stderr: "",
          durationMs: 25,
        },
      },
      probes: [
        {
          name: "typecheck",
          kind: "typecheck",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.passedProbes).toBe(1);
    expect(result.failedProbes).toBe(0);
    expect(engine.getLatestMatrix()?.matrixId).toBe(result.topologyMatrix.matrixId);
  });
});
