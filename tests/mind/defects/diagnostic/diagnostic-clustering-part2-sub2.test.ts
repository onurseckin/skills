import { describe, expect, it } from "bun:test";
import {
  DEFICIT_CRITICALITY_CLASSES,
  DIAGNOSTIC_ERROR_KINDS,
  DEFAULT_KNOWN_SUBSYSTEMS,
  inferSubsystemFromPath,
  extractStackFrames,
  computeStackSignature,
  parseRawDiagnostics,
  clusterDiagnosticErrors,
  runEmpiricalBaselineProbes,
  formatDeficitTopologyMatrixMarkdown,
  DiagnosticClusteringEngine,
  type DeficitTopologyMatrix,
  type ParsedDiagnosticError,
} from "../../../../olt/scripts/src/mind/defects/index.ts";

describe("Active Baseline Probing & Diagnostic Clustering Engine Suite", () => {
describe("Diagnostic Clustering Algorithm & 100+ Raw Errors Deduplication", () => {
    it("groups 100+ raw error occurrences into Class 1, Class 2, and Class 3 clusters", () => {
      const hundredErrors: ParsedDiagnosticError[] = [];
      const now = new Date().toISOString();

      // 50 Class 1 Compilation Errors across lines of same file
      for (let i = 0; i < 50; i++) {
        hundredErrors.push({
          id: `ERR-C1-${i}`,
          kind: DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
          errorCode: "TS2304",
          message: "Cannot find name 'MissingType'",
          normalizedMessage: "cannot find name '<name>'",
          filePath: "src/mind/core/types.ts",
          lineNumber: 10 + (i % 3),
          columnNumber: 5,
          subsystem: "mind/core",
          stackSignature: "SIG-TS-TS2304",
          timestamp: now,
        });
      }

      // 30 Class 2 Test Regression Invariant Violations
      for (let i = 0; i < 30; i++) {
        hundredErrors.push({
          id: `ERR-C2-${i}`,
          kind: DIAGNOSTIC_ERROR_KINDS.TEST_ASSERTION_FAILURE,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION,
          errorCode: "AssertionError",
          message: "Invariant check failed: expected quota <= 100 but got 105",
          normalizedMessage: "invariant check failed: expected quota <= <num> but got <num>",
          filePath: "src/mind/planning/pareto-arbitration.test.ts",
          lineNumber: 120,
          columnNumber: 8,
          subsystem: "mind/planning",
          stackSignature: "SIG-STK-PARETO-TEST",
          timestamp: now,
        });
      }

      // 20 Class 3 Lint Quality Deficits
      for (let i = 0; i < 20; i++) {
        hundredErrors.push({
          id: `ERR-C3-${i}`,
          kind: DIAGNOSTIC_ERROR_KINDS.LINT_WARNING,
          classification: DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT,
          errorCode: "@typescript-eslint/no-explicit-any",
          message: "Unexpected any. Specify a different type.",
          normalizedMessage: "unexpected any. specify a different type.",
          filePath: "src/mind/defects/legacy.ts",
          lineNumber: 40 + i,
          columnNumber: 12,
          subsystem: "mind/defects",
          stackSignature: "SIG-LINT-ANY",
          timestamp: now,
        });
      }

      const topologyMatrix = clusterDiagnosticErrors(hundredErrors, {
        matrixId: "TEST-TOPO-001",
      });

      expect(topologyMatrix.totalRawErrors).toBe(100);
      expect(topologyMatrix.totalClusters).toBe(3);
      expect(topologyMatrix.summary.blockers).toBe(1);
      expect(topologyMatrix.summary.regressions).toBe(1);
      expect(topologyMatrix.summary.qualityDeficits).toBe(1);

      // Verify cluster priority ordering
      const c1 = topologyMatrix.clusters[0];
      expect(c1).toBeDefined();
      expect(c1?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
      expect(c1?.priorityRank).toBe(1);
      expect(c1?.rawOccurrenceCount).toBe(50);
      expect(c1?.severityScore).toBeGreaterThanOrEqual(8.5);

      const c2 = topologyMatrix.clusters[1];
      expect(c2).toBeDefined();
      expect(c2?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION);
      expect(c2?.priorityRank).toBe(2);
      expect(c2?.rawOccurrenceCount).toBe(30);

      const c3 = topologyMatrix.clusters[2];
      expect(c3).toBeDefined();
      expect(c3?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT);
      expect(c3?.priorityRank).toBe(3);
      expect(c3?.rawOccurrenceCount).toBe(20);

      // Subsystem Health Scores
      const healthMindCore = topologyMatrix.subsystemHealthScores["mind/core"] ?? 1.0;
      expect(healthMindCore).toBeLessThan(0.75);
      const healthPlanning = topologyMatrix.subsystemHealthScores["mind/planning"] ?? 1.0;
      expect(healthPlanning).toBeLessThan(0.9);

      // Dynamic 70/20/10 Portfolio Allocation Recommendation
      const alloc = topologyMatrix.recommendedRoadmapAllocation;
      expect(alloc.coreStability).toBeGreaterThanOrEqual(80);
      expect(alloc.exploratory).toBeLessThanOrEqual(10);
      expect(alloc.coreStability + alloc.architecturalEvolution + alloc.exploratory).toBe(100);
    });
  });

describe("Baseline Probing Runner (Simulated & Live)", () => {
    it("runs empirical baseline probes with simulated outputs and builds topology matrix", async () => {
      const simulatedResult = await runEmpiricalBaselineProbes({
        simulate: true,
        simulatedOutputs: {
          typecheck: {
            exitCode: 1,
            stdout:
              "src/mind/defects/simulated.ts(1,1): error TS2304: Cannot find name 'SimulatedBlocker'.",
            stderr: "",
            durationMs: 120,
          },
          "unit-tests": {
            exitCode: 0,
            stdout: "15 tests passed",
            stderr: "",
            durationMs: 45,
          },
          "subsystem-health": {
            exitCode: 0,
            stdout: "All health probes operational",
            durationMs: 10,
          },
        },
      });

      expect(simulatedResult.success).toBe(false);
      expect(simulatedResult.totalProbes).toBe(3);
      expect(simulatedResult.failedProbes).toBe(1);
      expect(simulatedResult.topologyMatrix.summary.blockers).toBe(1);
      expect(simulatedResult.parsedErrors.length).toBeGreaterThan(0);
    });
  });

describe("Markdown Output Formatting & DiagnosticClusteringEngine Class", () => {
    it("formats high-fidelity GitHub-Flavored Markdown report", () => {
      const error: ParsedDiagnosticError = {
        id: "ERR-MD-01",
        kind: DIAGNOSTIC_ERROR_KINDS.TYPESCRIPT_COMPILATION,
        classification: DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER,
        errorCode: "TS2304",
        message: "Cannot find name 'TestSymbol'",
        normalizedMessage: "cannot find name '<name>'",
        filePath: "src/test.ts",
        subsystem: "mind/core",
        stackSignature: "SIG-TS-TS2304",
        timestamp: new Date().toISOString(),
      };

      const matrix = clusterDiagnosticErrors([error], { matrixId: "TOPO-MD-01" });
      const markdown = formatDeficitTopologyMatrixMarkdown(matrix);

      expect(markdown).toContain("# 🧭 Sovereign Mind Deficit Topology Matrix");
      expect(markdown).toContain("Recommended 70/20/10 Innovation Portfolio Roadmap Allocation");
      expect(markdown).toContain("Subsystem Health Scorecard");
      expect(markdown).toContain("Prioritized Deficit Clusters Registry");
    });

    it("operates DiagnosticClusteringEngine orchestrator instance and history", () => {
      const engine = new DiagnosticClusteringEngine({
        defaultTimeoutMs: 15000,
        similarityThreshold: 0.7,
      });

      const parsed = engine.parse("src/mind/defects/test.ts:1:1: error TS2304: Missing foo");
      expect(parsed.length).toBe(1);

      const matrix = engine.cluster(parsed);
      expect(matrix.totalRawErrors).toBe(1);
      expect(engine.getLatestMatrix()?.matrixId).toBe(matrix.matrixId);
      expect(engine.getHistory().length).toBe(1);

      const md = engine.formatMarkdown();
      expect(md).toContain("Deficit Topology Matrix");

      engine.clearHistory();
      expect(engine.getHistory().length).toBe(0);
      expect(engine.getLatestMatrix()).toBeUndefined();
    });
  });
});
