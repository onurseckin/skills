/**
 * @file diagnostic-engine-coverage.test.ts
 * Comprehensive unit tests for empirical baseline probe execution and the DiagnosticClusteringEngine orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiagnosticClusteringEngine,
  runEmpiricalBaselineProbes,
  type DeficitTopologyMatrix,
  type ProbeDefinition,
} from "../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";

describe("Empirical Baseline Probing & Diagnostic Engine Coverage Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "diagnostic-engine-test-"));
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("runEmpiricalBaselineProbes", () => {
    it("executes custom async runners and handles custom runner error throws", async () => {
      const probes: ProbeDefinition[] = [
        {
          name: "custom-success",
          kind: "custom",
          customRunner: async () => ({
            exitCode: 0,
            stdout: "custom runner ok",
            stderr: "",
            durationMs: 10,
          }),
        },
        {
          name: "custom-failure",
          kind: "custom",
          customRunner: () => {
            throw new Error("Custom runner catastrophic failure");
          },
        },
      ];

      const res = await runEmpiricalBaselineProbes({
        probes,
        continueOnFailure: true,
      });

      expect(res.totalProbes).toBe(2);
      expect(res.passedProbes).toBe(1);
      expect(res.failedProbes).toBe(1);
      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(1);
    });

    it("handles missing tsconfig.json and missing test runners for file checks", async () => {
      const emptyDir = join(tempDir, "empty-proj");
      mkdirSync(emptyDir);

      const probes: ProbeDefinition[] = [
        {
          name: "tc-missing",
          kind: "typecheck",
          command: "bun run typecheck",
          cwd: emptyDir,
        },
        {
          name: "test-missing",
          kind: "test",
          command: "bun test",
          cwd: emptyDir,
        },
      ];

      const res = await runEmpiricalBaselineProbes({ probes, continueOnFailure: true });
      expect(res.totalProbes).toBe(2);
      const tcRes = res.probes.find((p) => p.name === "tc-missing");
      expect(tcRes?.passed).toBe(false);
      expect(tcRes?.stderr).toContain("TS18003");

      const testRes = res.probes.find((p) => p.name === "test-missing");
      expect(testRes?.passed).toBe(true);
      expect(testRes?.stdout).toContain("0 tests found");
    });

    it("runs command array / string execution with callbacks and continueOnFailure: false", async () => {
      const events: string[] = [];
      const probes: ProbeDefinition[] = [
        {
          name: "cmd-pass",
          kind: "custom",
          command: ["echo", "pass-output"],
        },
        {
          name: "cmd-fail",
          kind: "custom",
          command: ["node", "-e", "process.exit(2)"],
        },
        {
          name: "cmd-unreached",
          kind: "custom",
          command: ["echo", "unreached"],
        },
      ];

      const res = await runEmpiricalBaselineProbes({
        probes,
        continueOnFailure: false,
        onProbeStart: (name) => events.push(`start:${name}`),
        onProbeCompleted: (p) => events.push(`done:${p.name}`),
      });

      expect(res.totalProbes).toBe(2);
      expect(res.failedProbes).toBe(1);
      expect(events).toContain("start:cmd-pass");
      expect(events).toContain("done:cmd-pass");
      expect(events).toContain("start:cmd-fail");
      expect(events).toContain("done:cmd-fail");
      expect(events).not.toContain("start:cmd-unreached");
    });

    it("handles fallback probe execution when no command or runner provided", async () => {
      const probes: ProbeDefinition[] = [
        {
          name: "default-health",
          kind: "health_probe",
        },
      ];

      const res = await runEmpiricalBaselineProbes({ probes });
      expect(res.passedProbes).toBe(1);
      expect(res.probes[0]?.stdout).toContain(
        "Health check probe 'default-health' completed nominally",
      );
    });
  });

  describe("DiagnosticClusteringEngine Class Orchestrator", () => {
    it("runs probes via engine and records matrix into history", async () => {
      const engine = new DiagnosticClusteringEngine({
        defaultTimeoutMs: 10000,
        similarityThreshold: 0.8,
      });

      const res = await engine.runProbes({
        simulate: true,
        simulatedOutputs: {
          typecheck: { exitCode: 0, stdout: "Typecheck ok", stderr: "", durationMs: 5 },
          "unit-tests": { exitCode: 0, stdout: "10 tests passed", stderr: "", durationMs: 10 },
          "subsystem-health": { exitCode: 0, stdout: "Healthy", durationMs: 2 },
        },
      });

      expect(res.success).toBe(true);
      expect(engine.getLatestMatrix()).toBeDefined();
      expect(engine.getHistory()).toHaveLength(1);
    });

    it("parses and clusters diagnostics caching matrix in history", () => {
      const engine = new DiagnosticClusteringEngine();
      const parsed = engine.parse("src/mind/defects/foo.ts:10:5: error TS2304: Missing foo");
      expect(parsed).toHaveLength(1);

      const matrix = engine.cluster(parsed);
      expect(matrix.totalRawErrors).toBe(1);
      expect(engine.getLatestMatrix()?.matrixId).toBe(matrix.matrixId);
    });

    it("formats markdown for empty engine state, cached matrix, and explicit matrix", () => {
      const engine = new DiagnosticClusteringEngine();
      const emptyMd = engine.formatMarkdown();
      expect(emptyMd).toContain("# No Deficit Topology Matrix Available");

      const parsed = engine.parse("src/mind/defects/bar.ts:1:1: error TS2304: Missing bar");
      const matrix = engine.cluster(parsed);
      const cachedMd = engine.formatMarkdown();
      expect(cachedMd).toContain("# 🧭 Sovereign Mind Deficit Topology Matrix");

      const explicitMd = engine.formatMarkdown(matrix);
      expect(explicitMd).toContain(matrix.matrixId);
    });

    it("maintains a maximum bounded FIFO history of 50 matrices", () => {
      const engine = new DiagnosticClusteringEngine();
      for (let i = 0; i < 60; i++) {
        const dummyMatrix: DeficitTopologyMatrix = {
          matrixId: `MAT-${i}`,
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
          subsystemHealthScores: {},
          recommendedRoadmapAllocation: {
            coreStability: 70,
            architecturalEvolution: 20,
            exploratory: 10,
            rationale: "ok",
          },
        };
        engine.recordMatrix(dummyMatrix);
      }

      expect(engine.getHistory().length).toBe(50);
      expect(engine.getHistory()[0]?.matrixId).toBe("MAT-10");
      expect(engine.getLatestMatrix()?.matrixId).toBe("MAT-59");

      engine.clearHistory();
      expect(engine.getHistory()).toHaveLength(0);
      expect(engine.getLatestMatrix()).toBeUndefined();
    });
  });
});
