import { existsSync } from "node:fs";
import { MINIMUM_BUN_VERSION } from "../../../core/config/contracts.ts";
import type { JsonObject } from "../../../core/contracts/index.ts";
import { verifyCapsuleDeep, verifyIntegrity } from "../../../engine/store/index.ts";
import { verifyStrictRepositoryCapsuleRoot } from "../capsule-root.ts";
import { verifyUnifiedEvidenceLocation } from "../evidence-location.ts";
import { auditTierConfinement } from "../tier-confinement/index.ts";
import { compareSemver } from "./mutation.ts";
import type { DoctorDiagnosticOptions, HarnessHealthCheck } from "./types.ts";

/**
 * Runs comprehensive doctor diagnostics on the harness environment.
 */
export async function runDoctorDiagnostics(
  options: DoctorDiagnosticOptions = {},
): Promise<readonly HarnessHealthCheck[]> {
  const checks: HarnessHealthCheck[] = [];

  // 1. Bun Runtime Version Check
  if (options.checkBunVersion !== false) {
    const minVersion =
      typeof options.minimumBunVersion === "string" && options.minimumBunVersion.length > 0
        ? options.minimumBunVersion
        : MINIMUM_BUN_VERSION;
    const isSupported = compareSemver(Bun.version, minVersion);
    if (isSupported) {
      checks.push({
        name: "bun_runtime_version",
        category: "bun_version",
        status: "pass",
        passed: true,
        message: `Bun version ${Bun.version} satisfies minimum requirement (>= ${minVersion})`,
        details: { currentVersion: Bun.version, minimumVersion: minVersion },
      });
    } else {
      checks.push({
        name: "bun_runtime_version",
        category: "bun_version",
        status: "fail",
        passed: false,
        message: `Bun version ${Bun.version} is below minimum requirement (${minVersion})`,
        details: { currentVersion: Bun.version, minimumVersion: minVersion },
        remediation: `Upgrade Bun to version ${minVersion} or newer`,
      });
    }
  }

  // 2. Capsule Root Confinement Check
  if (
    options.checkCapsuleRoot !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0
  ) {
    try {
      const rootAudit = verifyStrictRepositoryCapsuleRoot(options.runRoot, options.repoRoot);
      if (rootAudit.valid) {
        checks.push({
          name: "capsule_root_confinement",
          category: "capsule_root",
          status: "pass",
          passed: true,
          message:
            "Capsule root resides strictly under repository root .olt/capsules/ (or legacy .capsules/)",
          details: { runRoot: rootAudit.runRoot, repoRoot: rootAudit.repoRoot },
        });
      } else {
        checks.push({
          name: "capsule_root_confinement",
          category: "capsule_root",
          status: "fail",
          passed: false,
          message: rootAudit.issues.join("; "),
          details: {
            misplacedCapsules: rootAudit.misplacedCapsules,
            issues: rootAudit.issues,
          },
          remediation:
            "Ensure run capsules are stored exclusively at <repo-root>/.olt/capsules/<run-id> (or legacy <repo-root>/.capsules/<run-id>)",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "capsule_root_confinement",
        category: "capsule_root",
        status: "fail",
        passed: false,
        message: `Failed to audit capsule root: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Verify repository directory permissions and path existence",
      });
    }
  }

  // 3. Unified Evidence Location Check
  if (
    options.checkUnifiedEvidence !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0
  ) {
    try {
      const stateObj = options.state as JsonObject | null | undefined;
      const evidenceAudit = verifyUnifiedEvidenceLocation(options.runRoot, stateObj);
      if (evidenceAudit.valid) {
        checks.push({
          name: "unified_evidence_location",
          category: "evidence_location",
          status: "pass",
          passed: true,
          message: `All evidence paths (${evidenceAudit.checkedCount} checked) conform to unified evidence storage`,
          details: { checkedCount: evidenceAudit.checkedCount },
        });
      } else {
        checks.push({
          name: "unified_evidence_location",
          category: "evidence_location",
          status: "fail",
          passed: false,
          message: evidenceAudit.issues.join("; "),
          details: {
            invalidCount: evidenceAudit.invalidCount,
            invalidPaths: evidenceAudit.invalidPaths,
            issues: evidenceAudit.issues,
          },
          remediation: "Relocate all evidence and screenshots into <run-root>/evidence/",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "unified_evidence_location",
        category: "evidence_location",
        status: "fail",
        passed: false,
        message: `Failed to audit evidence locations: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Verify evidence store file integrity and paths",
      });
    }
  }

  // 4. Tier Confinement Check
  if (
    options.checkTierConfinement !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0 &&
    options.state !== null &&
    options.state !== undefined
  ) {
    try {
      const stateObj = options.state as JsonObject;
      const findings = auditTierConfinement(options.runRoot, stateObj);
      const critical = findings.filter((f) => f.severity === "critical");

      if (critical.length === 0) {
        checks.push({
          name: "tier_confinement_isolation",
          category: "tier_confinement",
          status: "pass",
          passed: true,
          message: "Supervisor roles strictly confined; zero code-editing violations observed",
          details: { totalFindings: findings.length },
        });
      } else {
        checks.push({
          name: "tier_confinement_isolation",
          category: "tier_confinement",
          status: "fail",
          passed: false,
          message: critical.map((f) => f.observation).join("; "),
          details: { criticalCount: critical.length, findings: critical },
          remediation:
            "Enforce strict separation: Only Tier 3 Implementers may edit repository files",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "tier_confinement_isolation",
        category: "tier_confinement",
        status: "fail",
        passed: false,
        message: `Failed to audit tier confinement: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Check agent grant records and command history in capsule state",
      });
    }
  }

  // 5. State & Layout Integrity Check
  if (
    options.checkIntegrity !== false &&
    typeof options.runRoot === "string" &&
    options.runRoot.length > 0 &&
    existsSync(options.runRoot)
  ) {
    try {
      const integrityIssues = [
        ...verifyIntegrity(options.runRoot),
        ...verifyCapsuleDeep(options.runRoot),
      ];
      if (integrityIssues.length === 0) {
        checks.push({
          name: "capsule_state_integrity",
          category: "integrity",
          status: "pass",
          passed: true,
          message: "Capsule state, manifest, event stream, and layout integrity verified",
        });
      } else {
        checks.push({
          name: "capsule_state_integrity",
          category: "integrity",
          status: "fail",
          passed: false,
          message: integrityIssues.map((i) => `${i.code}: ${i.message}`).join("; "),
          details: { issues: integrityIssues },
          remediation: "Recover capsule state projection or reconcile corrupted event logs",
        });
      }
    } catch (err: unknown) {
      checks.push({
        name: "capsule_state_integrity",
        category: "integrity",
        status: "fail",
        passed: false,
        message: `Failed to verify integrity: ${err instanceof Error ? err.message : String(err)}`,
        remediation: "Ensure capsule files are accessible and not locked",
      });
    }
  }

  // 6. Custom Diagnostics
  if (Array.isArray(options.customChecks) && options.customChecks.length > 0) {
    for (const customFn of options.customChecks) {
      try {
        const res = await customFn();
        checks.push(res);
      } catch (err: unknown) {
        checks.push({
          name: "custom_diagnostic_check",
          category: "custom",
          status: "fail",
          passed: false,
          message: `Custom health check threw an error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return checks;
}
