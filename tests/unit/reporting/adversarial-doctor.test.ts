import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  compareSemver,
  mutateWriteScopeForCounterfactual,
  runAdversarialCounterfactualCheck,
  runDoctorDiagnostics,
  certifyHarnessDoctor,
  assertDoctorCertification,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";

const SCRATCH_DIR = resolve(join(process.cwd(), "coverage", "scratch", "adversarial-doctor-tests"));

describe("doctor/adversarial-doctor", () => {
  beforeEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  });

  describe("compareSemver", () => {
    it("compares semver versions correctly", () => {
      expect(compareSemver("1.3.14", "1.2.0")).toBe(true);
      expect(compareSemver("1.2.0", "1.2.0")).toBe(true);
      expect(compareSemver("1.1.9", "1.2.0")).toBe(false);
      expect(compareSemver("2.0.0", "1.99.99")).toBe(true);
      expect(compareSemver("1.0.0", "2.0.0")).toBe(false);
      expect(compareSemver("1.2.3.4", "1.2.3")).toBe(true);
    });
  });

  describe("mutateWriteScopeForCounterfactual", () => {
    it("throws HarnessError on invalid file path arguments", () => {
      expect(() => mutateWriteScopeForCounterfactual("")).toThrow(HarnessError);
      expect(() => mutateWriteScopeForCounterfactual("   ")).toThrow(HarnessError);
      expect(() => mutateWriteScopeForCounterfactual(join(SCRATCH_DIR, "nonexistent.ts"))).toThrow(
        HarnessError,
      );
    });

    it("throws HarnessError if path is a directory rather than a file", () => {
      const dirPath = join(SCRATCH_DIR, "some-dir");
      mkdirSync(dirPath, { recursive: true });
      expect(() => mutateWriteScopeForCounterfactual(dirPath)).toThrow(HarnessError);
    });

    it("applies syntax_error mutation and reverts accurately", () => {
      const filePath = join(SCRATCH_DIR, "syntax.ts");
      const originalCode = "export const x = 42;\n";
      writeFileSync(filePath, originalCode, "utf-8");

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "syntax_error",
        now: "2026-08-24T00:00:00.000Z",
      });

      expect(mutation.mutationKind).toBe("syntax_error");
      expect(mutation.originalContent).toBe(originalCode);
      expect(mutation.mutatedContent).toContain("HARNESS ADVERSARIAL SYNTAX ERROR INJECTION");

      revert();
      expect(require("node:fs").readFileSync(filePath, "utf-8")).toBe(originalCode);
    });

    it("applies assertion_flip mutation matching patterns and fallback", () => {
      const filePath = join(SCRATCH_DIR, "assert.ts");
      const codeWithPattern =
        "expect(res).toBe(true); expect(flag).toBe(false); if (x === true) {}";
      writeFileSync(filePath, codeWithPattern, "utf-8");

      const res1 = mutateWriteScopeForCounterfactual(filePath, { kind: "assertion_flip" });
      expect(res1.mutation.mutatedContent).toContain("toBe(false)");
      expect(res1.mutation.mutatedContent).toContain("toBe(true)");
      expect(res1.mutation.mutatedContent).toContain("=== false");
      res1.revert();

      const codeWithoutPattern = "const y = 123;";
      writeFileSync(filePath, codeWithoutPattern, "utf-8");
      const res2 = mutateWriteScopeForCounterfactual(filePath, { kind: "assertion_flip" });
      expect(res2.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_ASSERTION_FLIP");
      res2.revert();
    });

    it("applies return_override, empty_file, exception_injection, and custom mutator", () => {
      const filePath = join(SCRATCH_DIR, "mutations.ts");
      const code = "export function run() { return 1; }";
      writeFileSync(filePath, code, "utf-8");

      // return_override
      const m1 = mutateWriteScopeForCounterfactual(filePath, { kind: "return_override" });
      expect(m1.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_RETURN_OVERRIDE");
      m1.revert();

      // empty_file
      const m2 = mutateWriteScopeForCounterfactual(filePath, { kind: "empty_file" });
      expect(m2.mutation.mutatedContent).toBe("");
      m2.revert();

      // exception_injection
      const m3 = mutateWriteScopeForCounterfactual(filePath, { kind: "exception_injection" });
      expect(m3.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_EXCEPTION");
      m3.revert();

      // custom
      const m4 = mutateWriteScopeForCounterfactual(filePath, {
        kind: "custom",
        customMutator: (c) => `// CUSTOM\n${c}`,
      });
      expect(m4.mutation.mutatedContent).toBe(`// CUSTOM\n${code}`);
      m4.revert();
    });

    it("throws HarnessError on custom mutation without customMutator function", () => {
      const filePath = join(SCRATCH_DIR, "custom-missing.ts");
      writeFileSync(filePath, "test", "utf-8");
      expect(() => mutateWriteScopeForCounterfactual(filePath, { kind: "custom" })).toThrow(
        HarnessError,
      );
    });
  });

  describe("runAdversarialCounterfactualCheck", () => {
    it("returns failed check when targetPath does not exist", async () => {
      const result = await runAdversarialCounterfactualCheck(join(SCRATCH_DIR, "missing-check.ts"));
      expect(result.passed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.error).toContain("File not found");
    });

    it("handles baseline test failure", async () => {
      const filePath = join(SCRATCH_DIR, "baseline-fail.test.ts");
      writeFileSync(filePath, "test content", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: () => ({ success: false, output: "Assertion failed", exitCode: 1 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.message).toContain("Baseline test failed");
    });

    it("handles baseline test runner throwing an exception", async () => {
      const filePath = join(SCRATCH_DIR, "baseline-throw.test.ts");
      writeFileSync(filePath, "test content", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: () => {
          throw new Error("Runner exploded");
        },
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.message).toContain("Baseline test execution threw an error");
    });

    it("passes check when baseline passes and mutated test fails (falsifiable gate)", async () => {
      const filePath = join(SCRATCH_DIR, "gate-falsifiable.test.ts");
      const code = "export const ok = true;";
      writeFileSync(filePath, code, "utf-8");

      let callCount = 0;
      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: () => {
          callCount++;
          // First call is baseline (passes), second call is mutated (fails)
          return callCount === 1
            ? { success: true, output: "Passed baseline", exitCode: 0 }
            : { success: false, output: "Syntax error", exitCode: 1 };
        },
      });

      expect(result.passed).toBe(true);
      expect(result.falsified).toBe(true);
      expect(result.baselinePassed).toBe(true);
      expect(result.message).toContain("Adversarial counterfactual check passed");
    });

    it("fails check when gate still passes despite mutation (not falsifiable)", async () => {
      const filePath = join(SCRATCH_DIR, "gate-not-falsifiable.test.ts");
      writeFileSync(filePath, "export const ok = true;", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: () => ({ success: true, output: "Always passes", exitCode: 0 }),
      });

      expect(result.passed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.baselinePassed).toBe(true);
      expect(result.message).toContain("gate is not falsifiable");
    });

    it("supports testCommand option with spawn execution", async () => {
      const filePath = join(SCRATCH_DIR, "command-check.test.ts");
      writeFileSync(filePath, "console.log('hi')", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testCommand: ["echo", "test-output"],
      });

      expect(result.baselinePassed).toBe(true);
    });
  });

  describe("runDoctorDiagnostics & certifyHarnessDoctor", () => {
    it("runs diagnostics across all categories", async () => {
      const runRoot = initRun(
        SCRATCH_DIR,
        "adv-doc-run",
        new TextEncoder().encode("Adversarial doctor test prompt"),
        "file",
        true,
      );

      const checks = await runDoctorDiagnostics({
        runRoot,
        repoRoot: SCRATCH_DIR,
        state: { agents: [], tasks: {}, commands: {} },
        customChecks: [
          () => ({
            name: "custom_pass",
            category: "custom",
            status: "pass",
            passed: true,
            message: "Custom check passed",
          }),
        ],
      });

      expect(checks.length).toBeGreaterThan(0);
      expect(checks.some((c) => c.name === "bun_runtime_version")).toBe(true);
      expect(checks.some((c) => c.name === "custom_pass")).toBe(true);
    });

    it("handles custom check throwing exception", async () => {
      const checks = await runDoctorDiagnostics({
        checkBunVersion: false,
        checkCapsuleRoot: false,
        checkUnifiedEvidence: false,
        checkTierConfinement: false,
        checkIntegrity: false,
        customChecks: [
          () => {
            throw new Error("Custom check crashed");
          },
        ],
      });

      expect(checks.length).toBe(1);
      expect(checks[0]?.status).toBe("fail");
      expect(checks[0]?.passed).toBe(false);
      expect(checks[0]?.message).toContain("Custom check crashed");
    });

    it("certifies doctor when all checks pass with writeScope adversarial checks", async () => {
      const filePath = join(SCRATCH_DIR, "scope-gate.test.ts");
      writeFileSync(filePath, "export const val = 1;", "utf-8");

      let callCount = 0;
      const report = await certifyHarnessDoctor({
        now: 1774350000000,
        runRoot: SCRATCH_DIR,
        checkBunVersion: true,
        checkCapsuleRoot: false,
        checkUnifiedEvidence: false,
        checkTierConfinement: false,
        checkIntegrity: false,
        runAdversarialChecks: true,
        writeScope: [filePath],
        adversarialTestRunner: () => {
          callCount++;
          return callCount === 1
            ? { success: true, output: "pass" }
            : { success: false, output: "falsified" };
        },
      });

      expect(report.certified).toBe(true);
      expect(report.criticalIssues).toEqual([]);
      expect(report.adversarialChecks.length).toBe(1);
      expect(report.markdown).toContain("Harness Doctor Certification Report");
      expect(report.markdown).toContain("✅ CERTIFIED");

      expect(() => assertDoctorCertification(report)).not.toThrow();
    });

    it("reports critical issues when bun version or adversarial checks fail", async () => {
      const filePath = join(SCRATCH_DIR, "failing-gate.test.ts");
      writeFileSync(filePath, "export const val = 1;", "utf-8");

      const report = await certifyHarnessDoctor({
        now: new Date(),
        minimumBunVersion: "999.0.0",
        runRoot: SCRATCH_DIR,
        runAdversarialChecks: true,
        writeScope: [filePath],
        adversarialTestRunner: () => ({ success: true, output: "unfalsifiable" }),
        customChecks: [
          () => ({
            name: "warn_check",
            category: "custom",
            status: "warn",
            passed: true,
            message: "Warning test",
          }),
        ],
      });

      expect(report.certified).toBe(false);
      expect(report.criticalIssues.length).toBeGreaterThan(0);
      expect(report.warnings.length).toBe(1);
      expect(report.markdown).toContain("❌ UNCERTIFIED");
      expect(report.markdown).toContain("## Critical Findings");

      expect(() => assertDoctorCertification(report)).toThrow(HarnessError);
    });

    it("throws HarnessError on uncertified doctor report in assertDoctorCertification", async () => {
      const uncertifiedReport = {
        certified: false,
        runRoot: "/fake",
        certifiedAt: new Date().toISOString(),
        bunVersion: "1.0.0",
        bunSupported: false,
        healthChecks: [],
        adversarialChecks: [],
        totalChecks: 1,
        passedChecks: 0,
        failedChecks: 1,
        criticalIssues: ["[BUN_VERSION] Bun version too low"],
        warnings: [],
        summary: "UNCERTIFIED",
        markdown: "# Report",
      };

      expect(() => assertDoctorCertification(uncertifiedReport)).toThrow(HarnessError);
    });
  });
});
