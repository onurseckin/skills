import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertDoctorCertification,
  certifyHarnessDoctor,
  runDoctorDiagnostics,
  type DoctorCertificationReport,
  type HarnessHealthCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts";

export const adversarialDoctorInvariantsSuiteName = "Adversarial Doctor - Certification, Diagnostics & Invariant Integrity";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe(adversarialDoctorInvariantsSuiteName, () => {
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
        expect(true).toBe(false);
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
    test("adversarial-doctor index.ts contains zero any and zero suppressions", () => {
      const srcPath = join(
        process.cwd(),
        "olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts",
      );

      const srcContent = readFileSync(srcPath, "utf-8");

      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(srcContent.includes(token)).toBe(false);
      }

      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(srcContent)).toBe(false);
    });

    test("adversarial-doctor-invariants.test.ts contains zero suppressions and zero any", () => {
      const testPath = join(process.cwd(), "tests/doctor/diagnostics/adversarial-doctor-invariants.test.ts");

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
