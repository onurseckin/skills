import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  autoHealCapsule,
  autoHealGitState,
  checkGitIndexIntegrity,
  checkPushbackQuotas,
  checkRepositoryHygiene,
  runDoctor,
  type DoctorAutoHealResult,
  type DoctorDiagnosticFinding,
} from "../../reporting/doctor.ts";
import {
  probeLiveQuotaTelemetry,
  type LifecycleQuotaTelemetry,
} from "./quota-lifecycle.ts";

export interface PreFlightDoctorAuditOptions {
  readonly actor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly graceSeconds?: number | undefined;
  readonly checkQuota?: boolean | undefined;
  readonly quotaThreshold?: number | undefined;
  readonly strict?: boolean | undefined;
}

export interface PreFlightDoctorAuditResult {
  readonly healthy: boolean;
  readonly autoHealed: readonly string[];
  readonly autoHealResult: DoctorAutoHealResult;
  readonly quotaTelemetry?: LifecycleQuotaTelemetry | undefined;
}

export interface PostFlightDoctorAuditOptions {
  readonly actor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly autoStageGit?: boolean | undefined;
  readonly enforceHygiene?: boolean | undefined;
  readonly enforceQuotas?: boolean | undefined;
  readonly checkLiveQuota?: boolean | undefined;
  readonly quotaThreshold?: number | undefined;
  readonly strict?: boolean | undefined;
}

export interface PostFlightDoctorAuditResult {
  readonly healthy: boolean;
  readonly stagedFiles: readonly string[];
  readonly findings: readonly DoctorDiagnosticFinding[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly quotaTelemetry?: LifecycleQuotaTelemetry | undefined;
}

/**
 * Pre-flight harness diagnostic hook: auto-heals torn event projections, stale leases,
 * dangling flock locks, and git index locks before task claims.
 */
export async function executePreFlightDoctorAudit(
  runRoot: string,
  options: PreFlightDoctorAuditOptions = {},
): Promise<PreFlightDoctorAuditResult> {
  const repoRoot =
    options.repoRoot !== undefined ? options.repoRoot : resolve(runRoot, "..", "..");
  const autoHealResult = autoHealCapsule(runRoot, {
    actor: options.actor,
    repoRoot,
    graceSeconds: options.graceSeconds,
  });

  let quotaTelemetry: LifecycleQuotaTelemetry | undefined;
  if (options.checkQuota) {
    quotaTelemetry = await probeLiveQuotaTelemetry({
      thresholdPercentage: options.quotaThreshold,
    });
    if (options.strict && quotaTelemetry.isTriggered) {
      throw new HarnessError(
        "INVALID_STATE",
        `Pre-flight quota check failed: quota circuit breaker is triggered (${quotaTelemetry.lowestQuotaPercentage !== null ? `${quotaTelemetry.lowestQuotaPercentage.toFixed(1)}%` : "unknown"} <= ${quotaTelemetry.evaluation.thresholdPercentage}%).`,
      );
    }
  }

  return {
    healthy: true,
    autoHealed: autoHealResult.autoHealed,
    autoHealResult,
    ...(quotaTelemetry !== undefined ? { quotaTelemetry } : {}),
  };
}

/**
 * Post-flight harness diagnostic hook: stages modified artifacts for reflog safety,
 * verifies repository hygiene (Invariant 30), and audits pushback quotas before task closure.
 */
export async function executePostFlightDoctorAudit(
  runRoot: string,
  options: PostFlightDoctorAuditOptions = {},
): Promise<PostFlightDoctorAuditResult> {
  const repoRoot =
    options.repoRoot !== undefined ? options.repoRoot : resolve(runRoot, "..", "..");
  const autoStageGit = options.autoStageGit !== undefined ? options.autoStageGit : true;
  const enforceHygiene = options.enforceHygiene !== undefined ? options.enforceHygiene : true;
  const enforceQuotas = options.enforceQuotas !== undefined ? options.enforceQuotas : true;
  const strict = options.strict !== undefined ? options.strict : false;

  const findings: DoctorDiagnosticFinding[] = [];
  const stagedFiles: string[] = [];

  // 1. Sub-Domain Completion Git Staging Invariant (Reflog Safety)
  if (autoStageGit) {
    const gitHeal = autoHealGitState({ repoRoot, stageModified: true, cleanIndexLock: true });
    stagedFiles.push(...gitHeal.stagedFiles);
  }

  // 2. Repository Hygiene Guard (Invariant 30)
  if (enforceHygiene) {
    const hygiene = checkRepositoryHygiene({ repoRoot });
    for (const v of hygiene.violations) {
      findings.push({
        code: v.violationType,
        severity: v.severity,
        engine: "checkRepositoryHygiene",
        message: v.message,
        details: { path: v.path },
      });
    }
  }

  // 3. Mandatory Pushback Quotas Audit
  if (enforceQuotas) {
    const doctorReport = await runDoctor(runRoot, { autoHeal: false });
    const quotaFindings =
      Array.isArray(doctorReport.doctor_findings)
        ? (doctorReport.doctor_findings as DoctorDiagnosticFinding[])
        : [];
    for (const f of quotaFindings) {
      if (f.engine === "checkPushbackQuotas" && f.severity === "ERROR") {
        findings.push(f);
      }
    }
  }

  // 4. Live Host Quota Audit
  let quotaTelemetry: LifecycleQuotaTelemetry | undefined;
  if (options.checkLiveQuota) {
    quotaTelemetry = await probeLiveQuotaTelemetry({
      thresholdPercentage: options.quotaThreshold,
    });
    if (quotaTelemetry.isTriggered) {
      findings.push({
        code: "QUOTA_CIRCUIT_BREAKER_TRIGGERED",
        severity: "WARN",
        engine: "probeLiveQuotaTelemetry",
        message: `Live quota circuit breaker is triggered (${quotaTelemetry.lowestQuotaPercentage !== null ? `${quotaTelemetry.lowestQuotaPercentage.toFixed(1)}%` : "unknown"} <= ${quotaTelemetry.evaluation.thresholdPercentage}%)`,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "ERROR").map((f) => f.message);
  const warnings = findings.filter((f) => f.severity === "WARN").map((f) => f.message);
  const healthy = errors.length === 0;

  if (strict && !healthy) {
    throw new HarnessError(
      "INTEGRITY",
      `Post-flight Doctor audit failed with ${errors.length} error(s):\n${errors.join("\n")}`,
    );
  }

  return {
    healthy,
    stagedFiles,
    findings,
    errors,
    warnings,
    ...(quotaTelemetry !== undefined ? { quotaTelemetry } : {}),
  };
}
