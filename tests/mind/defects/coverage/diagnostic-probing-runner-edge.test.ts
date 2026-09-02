import { describe, expect, it } from "bun:test";
import {
  runEmpiricalBaselineProbes,
  type ProbeDefinition,
  type SingleProbeResult,
} from "../../../../olt/scripts/src/mind/defects/diagnostic-clustering.ts";

describe("Empirical Baseline Probing Runner Edge Coverage", () => {
  it("executes simulated probes with custom outputs, timing, and error fields", async () => {
    const probes: ProbeDefinition[] = [
      { name: "sim-typecheck", kind: "typecheck" },
      { name: "sim-tests", kind: "test" },
    ];

    const started: string[] = [];
    const completed: string[] = [];

    const result = await runEmpiricalBaselineProbes({
      simulate: true,
      probes,
      simulatedOutputs: {
        "sim-typecheck": {
          exitCode: 0,
          stdout: "0 type errors found",
          stderr: "",
          durationMs: 40,
        },
        "sim-tests": {
          exitCode: 1,
          stdout: "",
          stderr: "AssertionError: expected true to be false",
          durationMs: 55,
          error: "Process exited with code 1",
        },
      },
      onProbeStart: (name) => started.push(name),
      onProbeCompleted: (res: SingleProbeResult) => completed.push(res.name),
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.passedProbes).toBe(1);
    expect(result.failedProbes).toBe(1);
    expect(started).toEqual(["sim-typecheck", "sim-tests"]);
    expect(completed).toEqual(["sim-typecheck", "sim-tests"]);
    expect(result.aggregatedRawLog).toContain("AssertionError");
    expect(result.parsedErrors.length).toBeGreaterThanOrEqual(1);
  });

  it("handles custom runners returning outputs and throwing Error or non-Error exceptions", async () => {
    const probes: ProbeDefinition[] = [
      {
        name: "custom-success",
        kind: "custom",
        customRunner: () => ({
          exitCode: 0,
          stdout: "Custom probe OK",
          stderr: "",
          durationMs: 10,
        }),
      },
      {
        name: "custom-error-throw",
        kind: "custom",
        customRunner: () => {
          throw new Error("Custom runner failure");
        },
      },
      {
        name: "custom-string-throw",
        kind: "custom",
        customRunner: () => {
          throw "Raw string failure";
        },
      },
    ];

    const result = await runEmpiricalBaselineProbes({ probes });
    expect(result.totalProbes).toBe(3);
    expect(result.passedProbes).toBe(1);
    expect(result.failedProbes).toBe(2);
    expect(result.probes[1]?.stderr).toContain("Custom runner failure");
    expect(result.probes[2]?.stderr).toContain("Raw string failure");
  });

  it("handles filesystem boundary checks for typecheck and test probes without configs", async () => {
    const probes: ProbeDefinition[] = [
      {
        name: "missing-tsconfig",
        kind: "typecheck",
        command: "bun run typecheck",
        cwd: "/nonexistent-path-for-test",
      },
      {
        name: "missing-pkg-json",
        kind: "test",
        command: "bun test",
        cwd: "/nonexistent-path-for-test",
      },
      {
        name: "fallback-probe",
        kind: "health_probe",
      },
    ];

    const result = await runEmpiricalBaselineProbes({ probes });
    expect(result.totalProbes).toBe(3);
    expect(result.probes[0]?.exitCode).toBe(1);
    expect(result.probes[0]?.stderr).toContain("error TS18003: No tsconfig.json found");
    expect(result.probes[1]?.exitCode).toBe(0);
    expect(result.probes[1]?.stdout).toContain("0 tests found");
    expect(result.probes[2]?.exitCode).toBe(0);
    expect(result.probes[2]?.stdout).toContain("completed nominally");
  });

  it("stops subsequent probes when continueOnFailure is false", async () => {
    const probes: ProbeDefinition[] = [
      {
        name: "probe-fail",
        kind: "custom",
        customRunner: () => ({
          exitCode: 1,
          stdout: "",
          stderr: "Fatal error",
          durationMs: 5,
        }),
      },
      {
        name: "probe-unreached",
        kind: "custom",
        customRunner: () => ({
          exitCode: 0,
          stdout: "Should not run",
          stderr: "",
          durationMs: 5,
        }),
      },
    ];

    const result = await runEmpiricalBaselineProbes({
      probes,
      continueOnFailure: false,
    });

    expect(result.totalProbes).toBe(1);
    expect(result.failedProbes).toBe(1);
    expect(result.probes[0]?.name).toBe("probe-fail");
  });
});
