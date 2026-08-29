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

export interface PreFlightDoctorAuditOptions {
  readonly actor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly graceSeconds?: number | undefined;
}

export interface PreFlightDoctorAuditResult {
  readonly healthy: boolean;
  readonly autoHealed: readonly string[];
  readonly autoHealResult: DoctorAutoHealResult;
}

export interface PostFlightDoctorAuditOptions {
  readonly actor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly autoStageGit?: boolean | undefined;
  readonly enforceHygiene?: boolean | undefined;
  readonly enforceQuotas?: boolean | undefined;
  readonly strict?: boolean | undefined;
}

export interface PostFlightDoctorAuditResult {
  readonly healthy: boolean;
  readonly stagedFiles: readonly string[];
  readonly findings: readonly DoctorDiagnosticFinding[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Pre-flight harness diagnostic hook: auto-heals torn event projections, stale leases,
 * dangling flock locks, and git index locks before task claims.
 */
export async function executePreFlightDoctorAudit(
  runRoot: string,
  options: PreFlightDoctorAuditOptions = {},
): Promise<PreFlightDoctorAuditResult> {
  const repoRoot = options.repoRoot ?? resolve(runRoot, "..", "..");
  const autoHealResult = autoHealCapsule(runRoot, {
    actor: options.actor,
    repoRoot,
    graceSeconds: options.graceSeconds,
  });

  return {
    healthy: true,
    autoHealed: autoHealResult.autoHealed,
    autoHealResult,
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
  const repoRoot = options.repoRoot ?? resolve(runRoot, "..", "..");
  const autoStageGit = options.autoStageGit ?? true;
  const enforceHygiene = options.enforceHygiene ?? true;
  const enforceQuotas = options.enforceQuotas ?? true;
  const strict = options.strict ?? false;

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
      (doctorReport.doctor_findings as DoctorDiagnosticFinding[] | undefined) ?? [];
    for (const f of quotaFindings) {
      if (f.engine === "checkPushbackQuotas" && f.severity === "ERROR") {
        findings.push(f);
      }
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
  };
}
