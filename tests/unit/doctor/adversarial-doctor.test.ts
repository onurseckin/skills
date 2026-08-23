import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
import {
  assertDoctorCertification,
  certifyHarnessDoctor,
  compareSemver,
  mutateWriteScopeForCounterfactual,
  runAdversarialCounterfactualCheck,
  runDoctorDiagnostics,
  type AdversarialCheckResult,
  type CounterfactualMutation,
  type DoctorCertificationReport,
  type HarnessHealthCheck,
  type MutationKind,
} from "../../../olt/scripts/src/doctor/adversarial-doctor.ts";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("Adversarial Doctor & Counterfactual Certification", () => {
  describe("compareSemver", () => {
    test("correctly evaluates version comparisons", () => {
      expect(compareSemver("1.3.14", "1.3.0")).toBe(true);
      expect(compareSemver("1.3.0", "1.3.0")).toBe(true);
      expect(compareSemver("1.2.9", "1.3.0")).toBe(false);
      expect(compareSemver("2.0.0", "1.9.9")).toBe(true);
      expect(compareSemver("1.0.0", "2.0.0")).toBe(false);
    });
  });

  describe("mutateWriteScopeForCounterfactual", () => {
    test("throws INVALID_ARGUMENT on empty or non-existent file path", () => {
      expect(() => mutateWriteScopeForCounterfactual("")).toThrow(HarnessError);
      expect(() => mutateWriteScopeForCounterfactual("/non/existent/path/file.ts")).toThrow(
        HarnessError,
      );
    });

    test("applies syntax_error mutation and reverts cleanly", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-syntax-"));
      tempDirs.push(dir);
      const filePath = join(dir, "sample.ts");
      const original = 'export const greeting = "hello";\n';
      await writeFile(filePath, original, "utf-8");

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "syntax_error",
      });

      expect(mutation.mutationKind).toBe("syntax_error");
      expect(mutation.filePath).toBe(filePath);
      expect(mutation.originalContent).toBe(original);
      expect(mutation.mutatedContent).toContain("INJECTED_ADVERSARIAL_SYNTAX_ERROR");

      const onDisk = await readFile(filePath, "utf-8");
      expect(onDisk).toBe(mutation.mutatedContent);

      revert();
      const revertedOnDisk = await readFile(filePath, "utf-8");
      expect(revertedOnDisk).toBe(original);
    });

    test("applies assertion_flip mutation and reverts cleanly", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-flip-"));
      tempDirs.push(dir);
      const filePath = join(dir, "test-sample.ts");
      const original = "expect(result).toBe(true);\nexpect(isValid).toBeTrue();\n";
      await writeFile(filePath, original, "utf-8");

      const { mutation, revert } = mutateWriteScopeForCounterfactual(filePath, {
        kind: "assertion_flip",
      });

      expect(mutation.mutationKind).toBe("assertion_flip");
      expect(mutation.mutatedContent).toContain("toBe(false)");
      expect(mutation.mutatedContent).toContain("toBeFalse()");

      revert();
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("applies return_override, empty_file, and exception_injection mutations", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-types-"));
      tempDirs.push(dir);
      const filePath = join(dir, "target.ts");
      const original = "export function calculate(): number { return 42; }\n";
      await writeFile(filePath, original, "utf-8");

      // return_override
      const res1 = mutateWriteScopeForCounterfactual(filePath, { kind: "return_override" });
      expect(res1.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_RETURN_OVERRIDE");
      res1.revert();

      // empty_file
      const res2 = mutateWriteScopeForCounterfactual(filePath, { kind: "empty_file" });
      expect(res2.mutation.mutatedContent).toBe("");
      res2.revert();

      // exception_injection
      const res3 = mutateWriteScopeForCounterfactual(filePath, { kind: "exception_injection" });
      expect(res3.mutation.mutatedContent).toContain("HARNESS_ADVERSARIAL_EXCEPTION");
      res3.revert();

      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("applies custom mutator and rejects custom without function", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-mut-custom-"));
      tempDirs.push(dir);
      const filePath = join(dir, "custom.ts");
      const original = "const x = 10;\n";
      await writeFile(filePath, original, "utf-8");

      expect(() => mutateWriteScopeForCounterfactual(filePath, { kind: "custom" })).toThrow(
        HarnessError,
      );

      const res = mutateWriteScopeForCounterfactual(filePath, {
        kind: "custom",
        customMutator: (c) => c.replace("10", "999"),
      });
      expect(res.mutation.mutatedContent).toBe("const x = 999;\n");
      res.revert();
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });
  });

  describe("runAdversarialCounterfactualCheck", () => {
    test("handles non-existent target path gracefully", async () => {
      const result = await runAdversarialCounterfactualCheck("/non/existent/target.ts");
      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Target path does not exist");
    });

    test("passes when baseline succeeds and mutated test fails (falsifiable)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-pass-"));
      tempDirs.push(dir);
      const filePath = join(dir, "valid.test.ts");
      const original = "export const ok = true;\n";
      await writeFile(filePath, original, "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        testRunner: async (p) => {
          const content = await readFile(p, "utf-8");
          const hasSyntaxError = content.includes("INJECTED_ADVERSARIAL_SYNTAX_ERROR");
          return {
            success: !hasSyntaxError,
            output: hasSyntaxError ? "Syntax error detected" : "All tests passed",
            exitCode: hasSyntaxError ? 1 : 0,
          };
        },
      });

      expect(result.passed).toBe(true);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(true);
      expect(result.mutation?.mutationKind).toBe("syntax_error");
      // File must be completely reverted back
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("fails when mutated code still passes test runner (lacks falsifiability)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-unfalsifiable-"));
      tempDirs.push(dir);
      const filePath = join(dir, "no-op.test.ts");
      const original = "export const val = 1;\n";
      await writeFile(filePath, original, "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        mutationKind: "syntax_error",
        // Test runner always returns success regardless of content
        testRunner: async () => ({ success: true, output: "Mock passed always", exitCode: 0 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(true);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("gate is not falsifiable");
      expect(await readFile(filePath, "utf-8")).toBe(original);
    });

    test("fails when baseline is already failing before mutation", async () => {
      const dir = await mkdtemp(join(tmpdir(), "adv-check-baseline-fail-"));
      tempDirs.push(dir);
      const filePath = join(dir, "broken.test.ts");
      await writeFile(filePath, "broken content", "utf-8");

      const result = await runAdversarialCounterfactualCheck(filePath, {
        testRunner: async () => ({ success: false, output: "Pre-existing failure", exitCode: 1 }),
      });

      expect(result.passed).toBe(false);
      expect(result.baselinePassed).toBe(false);
      expect(result.falsified).toBe(false);
      expect(result.message).toContain("Baseline test failed before adversarial mutation");
    });
  });

  describe("runDoctorDiagnostics", () => {
    test("runs bun version diagnostics accurately", async () => {
      const checksPass = await runDoctorDiagnostics({
        minimumBunVersion: "1.0.0",
        checkCapsuleRoot: false,
        checkUnifiedEvidence: false,
        checkTierConfinement: false,
        checkIntegrity: false,
      });

      expect(checksPass.length).toBe(1);
      expect(checksPass[0]?.category).toBe("bun_version");
      expect(checksPass[0]?.passed).toBe(true);
      expect(checksPass[0]?.status).toBe("pass");

      const checksFail = await runDoctorDiagnostics({
        minimumBunVersion: "99.0.0",
        checkCapsuleRoot: false,
        checkUnifiedEvidence: false,
        checkTierConfinement: false,
        checkIntegrity: false,
      });

      expect(checksFail.length).toBe(1);
      expect(checksFail[0]?.passed).toBe(false);
      expect(checksFail[0]?.status).toBe("fail");
      expect(checksFail[0]?.remediation).toBeDefined();
    });

    test("runs capsule root, evidence location, and tier confinement diagnostics", async () => {
      const repo = await mkdtemp(join(tmpdir(), "adv-diag-repo-"));
      tempDirs.push(repo);
      await mkdir(join(repo, ".git"));
      const runRoot = join(repo, ".capsules", "run-diag-1");
      await mkdir(runRoot, { recursive: true });
      await mkdir(join(runRoot, "evidence"), { recursive: true });

      const state = {
        meta: { run_id: "run-diag-1" },
        agents: {},
        commands: {},
        tasks: {},
      };

      const checks = await runDoctorDiagnostics({
        runRoot,
        repoRoot: repo,
        state,
        checkBunVersion: true,
        checkCapsuleRoot: true,
        checkUnifiedEvidence: true,
        checkTierConfinement: true,
        checkIntegrity: false,
      });

      expect(checks.some((c) => c.category === "capsule_root" && c.passed)).toBe(true);
      expect(checks.some((c) => c.category === "evidence_location" && c.passed)).toBe(true);
      expect(checks.some((c) => c.category === "tier_confinement" && c.passed)).toBe(true);
    });

    test("incorporates custom diagnostic health checks", async () => {
      const customCheckPass: HarnessHealthCheck = {
        name: "custom_auth_probe",
        category: "custom",
        status: "pass",
        passed: true,
        message: "Custom auth tokens valid",
      };

      const checks = await runDoctorDiagnostics({
        checkBunVersion: false,
        checkCapsuleRoot: false,
        checkUnifiedEvidence: false,
        checkTierConfinement: false,
        checkIntegrity: false,
        customChecks: [async () => customCheckPass],
      });

      expect(checks.length).toBe(1);
      expect(checks[0]?.name).toBe("custom_auth_probe");
      expect(checks[0]?.passed).toBe(true);
    });
  });

  describe("certifyHarnessDoctor and assertDoctorCertification", () => {
    test("certifies successfully when all health checks and adversarial checks pass", async () => {
      const repo = await mkdtemp(join(tmpdir(), "adv-cert-pass-"));
      tempDirs.push(repo);
      await mkdir(join(repo, ".git"));
      const runRoot = join(repo, ".capsules", "run-cert-1");
      await mkdir(runRoot, { recursive: true });

      const testFile = join(runRoot, "component.test.ts");
      await writeFile(testFile, "export const certified = true;\n", "utf-8");

      const report: DoctorCertificationReport = await certifyHarnessDoctor({
        runRoot,
        repoRoot: repo,
        writeScope: [testFile],
        minimumBunVersion: "1.0.0",
        checkIntegrity: false,
        adversarialTestRunner: async (p) => {
          const content = await readFile(p, "utf-8");
          const mutated = content.includes("INJECTED_ADVERSARIAL_SYNTAX_ERROR");
          return { success: !mutated, exitCode: mutated ? 1 : 0 };
        },
      });

      expect(report.certified).toBe(true);
      expect(report.criticalIssues.length).toBe(0);
      expect(report.failedChecks).toBe(0);
      expect(report.adversarialChecks.length).toBe(1);
      expect(report.adversarialChecks[0]?.passed).toBe(true);
      expect(report.markdown).toContain("Harness Doctor Certification Report");
      expect(report.markdown).toContain("✅ CERTIFIED");

      // Assert certification does not throw
      expect(() => assertDoctorCertification(report)).not.toThrow();
    });

    test("assertDoctorCertification throws HarnessError when report is not certified", async () => {
      const failingReport: DoctorCertificationReport = {
        certified: false,
        runRoot: "/tmp/fake-run",
        certifiedAt: new Date().toISOString(),
        bunVersion: "1.3.14",
        bunSupported: true,
        healthChecks: [
          {
            name: "tier_confinement_isolation",
            category: "tier_confinement",
            status: "fail",
            passed: false,
            message: "Supervisor role edited code",
          },
        ],
        adversarialChecks: [],
        totalChecks: 1,
        passedChecks: 0,
        failedChecks: 1,
        criticalIssues: [
          "[TIER_CONFINEMENT] tier_confinement_isolation: Supervisor role edited code",
        ],
        warnings: [],
        summary: "Harness Doctor UNCERTIFIED: 1 critical issue detected",
        markdown: "# Report",
      };

      try {
        assertDoctorCertification(failingReport);
        expect(true).toBe(false); // Unreachable
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("INTEGRITY");
          expect(err.message).toContain("Supervisor role edited code");
          expect(err.fix).toBeDefined();
        }
      }
    });
  });

  describe("Static Invariants: Zero Any & Zero Compiler Suppressions", () => {
    test("adversarial-doctor.ts contains zero any and zero suppressions", () => {
      const srcPath = join(process.cwd(), "olt/scripts/src/doctor/adversarial-doctor.ts");

      const srcContent = readFileSync(srcPath, "utf-8");

      // Zero suppressions
      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(srcContent.includes(token)).toBe(false);
      }

      // Zero untyped any declarations
      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(srcContent)).toBe(false);
    });

    test("adversarial-doctor.test.ts contains zero suppressions and zero any", () => {
      const testPath = join(process.cwd(), "tests/unit/doctor/adversarial-doctor.test.ts");

      const testContent = readFileSync(testPath, "utf-8");

      const lines = testContent
        .split("\n")
        .filter(
          (l) =>
            !l.includes("suppressionTokens") &&
            !l.includes("anyRegex") &&
            !l.includes("Static Invariants"),
        );
      const filtered = lines.join("\n");

      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(filtered.includes(token)).toBe(false);
      }

      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(filtered)).toBe(false);
    });
  });
});
