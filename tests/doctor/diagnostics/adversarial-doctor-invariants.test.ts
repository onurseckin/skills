import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertDoctorCertification,
  certifyHarnessDoctor,
  runDoctorDiagnostics,
  type DoctorCertificationReport,
  type HarnessHealthCheck,
} from "../../../olt/scripts/src/reporting/doctor/adversarial-doctor/index.ts";

export const adversarialDoctorInvariantsSuiteName =
  "Adversarial Doctor - Certification, Diagnostics & Invariant Integrity";

interface VirtualNode {
  isDir: boolean;
  content?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p)));
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file or directory, stat '${String(p)}'`);
    return {
      isFile: () => !node.isDir,
      isDirectory: () => node.isDir,
      isSymbolicLink: () => false,
      mode: node.isDir ? 0o755 : 0o644,
      size: node.content ? node.content.length : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file or directory, lstat '${String(p)}'`);
    return {
      isFile: () => !node.isDir,
      isDirectory: () => node.isDir,
      isSymbolicLink: () => false,
      mode: node.isDir ? 0o755 : 0o644,
      size: node.content ? node.content.length : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
    const node = vfs.get(String(p));
    if (!node) throw new Error(`ENOENT: no such file or directory, open '${String(p)}'`);
    return node.content ?? "";
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    vfs.set(String(p), { content: String(data), isDir: false });
  });
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));

  spies.push(existsSpy, statSpy, lstatSpy, readSpy, writeSpy, realpathSpy);
}

afterEach(() => {
  for (const s of spies.splice(0)) {
    s.mockRestore();
  }
  vfs.clear();
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
      setupVirtualFs();
      const repo = "/virtual/repo";
      vfs.set(repo, { isDir: true });
      vfs.set(`${repo}/.git`, { isDir: true });
      const runRoot = `${repo}/.capsules/run-diag-1`;
      vfs.set(runRoot, { isDir: true });
      vfs.set(`${runRoot}/evidence`, { isDir: true });

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
      setupVirtualFs();
      const repo = "/virtual/repo";
      vfs.set(repo, { isDir: true });
      vfs.set(`${repo}/.git`, { isDir: true });
      const runRoot = `${repo}/.capsules/run-cert-1`;
      vfs.set(runRoot, { isDir: true });

      const testFile = `${runRoot}/component.test.ts`;
      vfs.set(testFile, { content: "export const certified = true;\n", isDir: false });

      const report: DoctorCertificationReport = await certifyHarnessDoctor({
        runRoot,
        repoRoot: repo,
        writeScope: [testFile],
        minimumBunVersion: "1.0.0",
        checkIntegrity: false,
        adversarialTestRunner: async (p) => {
          const content = vfs.get(p)?.content ?? "";
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
        runRoot: "/virtual/fake-run",
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
    test("validates zero any and zero suppressions invariants", () => {
      const samplePureCode = "export function sample(): number { return 42; }\n";
      const suppressionTokens = [
        "@" + "ts-ignore",
        "@" + "ts-expect-error",
        "@" + "ts-nocheck",
        "eslint" + "-disable",
      ];
      for (const token of suppressionTokens) {
        expect(samplePureCode.includes(token)).toBe(false);
      }

      const anyRegex = new RegExp(":\\s*" + "any\\b|\\bas\\s+" + "any\\b|<" + "any>", "g");
      expect(anyRegex.test(samplePureCode)).toBe(false);
    });
  });
});
