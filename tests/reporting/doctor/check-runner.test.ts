import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  runAdversarialCounterfactualCheck,
  runAdversarialDoctorCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/check-runner.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

describe("adversarial-doctor check-runner coverage", () => {
  let sandboxDir: string;
  let testFile: string;

  beforeEach(() => {
    setupVirtualReportingFS();
    sandboxDir = tempDir("adv-runner");
    testFile = join(sandboxDir, "sample.ts");
    fs.writeFileSync(testFile, "export const value = 42;\n");
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  it("fails early when target path does not exist", async () => {
    const missingPath = join(sandboxDir, "missing.ts");
    const result = await runAdversarialCounterfactualCheck(missingPath);

    expect(result.passed).toBe(false);
    expect(result.falsified).toBe(false);
    expect(result.baselinePassed).toBe(false);
    expect(result.message).toContain("Target path does not exist");
    expect(result.error).toContain("File not found");
  });

  it("passes check when baseline succeeds and mutated test fails", async () => {
    let callCount = 0;
    const testRunner = async () => {
      callCount += 1;
      return { success: callCount === 1, output: callCount === 1 ? "ok" : "syntax error" };
    };

    const result = await runAdversarialCounterfactualCheck(testFile, {
      checkName: "custom-check",
      allowedRoots: [sandboxDir],
      testRunner,
    });

    expect(result.name).toBe("custom-check");
    expect(result.passed).toBe(true);
    expect(result.falsified).toBe(true);
    expect(result.baselinePassed).toBe(true);
    expect(result.message).toContain("Test gate detected injected defect");
  });

  it("fails check when mutated test continues to pass (not falsifiable)", async () => {
    const testRunner = async () => ({ success: true, output: "all green" });

    const result = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testRunner,
    });

    expect(result.passed).toBe(false);
    expect(result.falsified).toBe(false);
    expect(result.baselinePassed).toBe(true);
    expect(result.message).toContain("gate is not falsifiable");
  });

  it("handles baseline test runner failure or exception gracefully", async () => {
    const failingRunner = async () => ({ success: false, output: "baseline broke", exitCode: 1 });
    const resFail = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testRunner: failingRunner,
    });
    expect(resFail.passed).toBe(false);
    expect(resFail.baselinePassed).toBe(false);
    expect(resFail.message).toContain("Baseline test failed");

    const throwingRunner = async () => {
      throw new Error("Runner crash");
    };
    const resThrow = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testRunner: throwingRunner,
    });
    expect(resThrow.passed).toBe(false);
    expect(resThrow.baselinePassed).toBe(false);
    expect(resThrow.message).toContain("Baseline test execution threw an error");
  });

  it("handles mutation execution failure gracefully", async () => {
    const throwingMutator = () => {
      throw new Error("Mutator boom");
    };

    const result = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      mutationKind: "custom",
      customMutator: throwingMutator,
    });

    expect(result.passed).toBe(false);
    expect(result.falsified).toBe(false);
    expect(result.baselinePassed).toBe(true);
    expect(result.message).toContain("Error occurred while executing adversarial mutation test");
    expect(result.error).toContain("Mutator boom");
  });

  it("throws HarnessError if revert step fails after mutation", async () => {
    let callCount = 0;
    const revertThrowingRunner = async () => {
      callCount += 1;
      if (callCount === 2) {
        fs.unlinkSync(testFile);
        fs.mkdirSync(testFile);
      }
      return { success: callCount === 1 };
    };

    await expect(
      runAdversarialCounterfactualCheck(testFile, {
        allowedRoots: [sandboxDir],
        testRunner: revertThrowingRunner,
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("handles testCommand execution with real spawn and error handling", async () => {
    const emptyCmd = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testCommand: [""],
    });
    expect(emptyCmd.baselinePassed).toBe(false);

    const okCmd = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testCommand: ["echo", "pass"],
    });
    expect(okCmd.baselinePassed).toBe(true);

    const failCmd = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
      testCommand: ["git", "config", "--get-regexp", "nonexistent"],
    });
    expect(failCmd.baselinePassed).toBe(false);
  });

  it("executes bun test runner for .test.ts files and regular files", async () => {
    const testPath = join(sandboxDir, "dummy.test.ts");
    fs.writeFileSync(testPath, "export const a = 1;");
    const testResult = await runAdversarialCounterfactualCheck(testPath, {
      allowedRoots: [sandboxDir],
    });
    expect(testResult.checkId).toBeDefined();

    const normalResult = await runAdversarialCounterfactualCheck(testFile, {
      allowedRoots: [sandboxDir],
    });
    expect(normalResult.baselinePassed).toBe(true);
    expect(normalResult.name).toBe("adversarial-falsifiability-sample.ts");
  });

  it("verifies alias export runAdversarialDoctorCheck", () => {
    expect(runAdversarialDoctorCheck).toBe(runAdversarialCounterfactualCheck);
  });
});
