import { describe, expect, spyOn, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import * as doctorModule from "../../../../olt/scripts/src/reporting/doctor.ts";
import {
  executePostFlightDoctorAudit,
  executePreFlightDoctorAudit,
} from "../../../../olt/scripts/src/workflow/lifecycle/harness-hooks.ts";
import * as quotaModule from "../../../../olt/scripts/src/workflow/lifecycle/quota-lifecycle.ts";

describe("Pre/Post Run Automated Diagnostic Hooks (In-Memory Virtualization)", () => {
  test("executePreFlightDoctorAudit auto-heals corrupted state and stale locks", async () => {
    const autoHealSpy = spyOn(doctorModule, "autoHealCapsule").mockReturnValue({
      healthy: true,
      autoHealed: ["projection_recovered", "locks_cleared"],
      projectionRecovered: true,
      gitIndexHealed: false,
      quarantinedFragments: [],
      recoveredLeases: [],
      danglingLocksCleared: ["lock-1"],
      migratedLedgers: [],
      gitArtifactsStaged: [],
    });

    try {
      const preFlight = await executePreFlightDoctorAudit("/virtual/capsules/run-1", {
        repoRoot: "/virtual/repo",
      });
      expect(preFlight.healthy).toBe(true);
      expect(preFlight.autoHealResult.projectionRecovered).toBe(true);
      expect(preFlight.autoHealed).toContain("projection_recovered");
      expect(autoHealSpy).toHaveBeenCalled();
    } finally {
      autoHealSpy.mockRestore();
    }
  });

  test("executePreFlightDoctorAudit handles quota check and strict circuit breaker", async () => {
    const autoHealSpy = spyOn(doctorModule, "autoHealCapsule").mockReturnValue({
      healthy: true,
      autoHealed: [],
      projectionRecovered: false,
      gitIndexHealed: false,
      quarantinedFragments: [],
      recoveredLeases: [],
      danglingLocksCleared: [],
      migratedLedgers: [],
      gitArtifactsStaged: [],
    });

    const quotaSpy = spyOn(quotaModule, "probeLiveQuotaTelemetry").mockResolvedValue({
      isTriggered: true,
      lowestQuotaPercentage: 5.0,
      evaluation: {
        thresholdPercentage: 10,
      } as unknown as quotaModule.LifecycleQuotaTelemetry["evaluation"],
    } as quotaModule.LifecycleQuotaTelemetry);

    try {
      await expect(
        executePreFlightDoctorAudit("/virtual/capsules/run-1", {
          repoRoot: "/virtual/repo",
          checkQuota: true,
          quotaThreshold: 10,
          strict: true,
        }),
      ).rejects.toThrow(HarnessError);

      const nonStrict = await executePreFlightDoctorAudit("/virtual/capsules/run-1", {
        repoRoot: "/virtual/repo",
        checkQuota: true,
        quotaThreshold: 10,
        strict: false,
      });
      expect(nonStrict.healthy).toBe(true);
      expect(nonStrict.quotaTelemetry).toBeDefined();
    } finally {
      autoHealSpy.mockRestore();
      quotaSpy.mockRestore();
    }
  });

  test("executePostFlightDoctorAudit auto-stages modified files and verifies hygiene", async () => {
    const gitHealSpy = spyOn(doctorModule, "autoHealGitState").mockReturnValue({
      gitIndexHealed: true,
      stagedFiles: ["README.md", "src/index.ts"],
    });

    const hygieneSpy = spyOn(doctorModule, "checkRepositoryHygiene").mockReturnValue({
      violations: [],
    } as unknown as ReturnType<typeof doctorModule.checkRepositoryHygiene>);

    try {
      const postFlight = await executePostFlightDoctorAudit("/virtual/capsules/run-1", {
        repoRoot: "/virtual/repo",
        autoStageGit: true,
        enforceHygiene: true,
        enforceQuotas: false,
      });

      expect(postFlight.healthy).toBe(true);
      expect(postFlight.stagedFiles).toContain("README.md");
      expect(gitHealSpy).toHaveBeenCalled();
      expect(hygieneSpy).toHaveBeenCalled();
    } finally {
      gitHealSpy.mockRestore();
      hygieneSpy.mockRestore();
    }
  });

  test("executePostFlightDoctorAudit handles defaults, quotas, hygiene violations, and strict mode", async () => {
    const gitHealSpy = spyOn(doctorModule, "autoHealGitState").mockReturnValue({
      gitIndexHealed: false,
      stagedFiles: [],
    });

    const hygieneSpy = spyOn(doctorModule, "checkRepositoryHygiene").mockReturnValue({
      violations: [
        {
          violationType: "FORBIDDEN_SCRATCH_LEAK",
          severity: "ERROR",
          message: "scratch leak detected",
          path: ".scratch_temp_leak",
        },
      ],
    } as unknown as ReturnType<typeof doctorModule.checkRepositoryHygiene>);

    const doctorSpy = spyOn(doctorModule, "runDoctor").mockResolvedValue({
      doctor_findings: [
        {
          code: "PUSHBACK_QUOTA_BREACH",
          severity: "ERROR",
          engine: "checkPushbackQuotas",
          message: "pushback quota exceeded",
        },
      ],
    } as unknown as Awaited<ReturnType<typeof doctorModule.runDoctor>>);

    try {
      const postFlight = await executePostFlightDoctorAudit("/virtual/capsules/run-1", {
        repoRoot: "/virtual/repo",
        autoStageGit: true,
        enforceHygiene: true,
        enforceQuotas: true,
      });

      expect(postFlight.healthy).toBe(false);
      expect(postFlight.errors.length).toBeGreaterThan(0);
      expect(postFlight.findings.some((f) => f.engine === "checkPushbackQuotas")).toBe(true);

      await expect(
        executePostFlightDoctorAudit("/virtual/capsules/run-1", {
          repoRoot: "/virtual/repo",
          autoStageGit: false,
          enforceHygiene: true,
          enforceQuotas: false,
          strict: true,
        }),
      ).rejects.toThrow(HarnessError);
    } finally {
      gitHealSpy.mockRestore();
      hygieneSpy.mockRestore();
      doctorSpy.mockRestore();
    }
  });
});
