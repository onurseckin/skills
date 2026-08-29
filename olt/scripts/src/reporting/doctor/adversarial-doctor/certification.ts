import { basename } from "node:path";
import { MINIMUM_BUN_VERSION } from "../../../core/config/contracts.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot } from "../../../core/shared/paths.ts";
import { compareSemver, parseIsoTimestamp, runAdversarialCounterfactualCheck } from "./mutation.ts";
import { runDoctorDiagnostics } from "./diagnostics.ts";
import type {
  AdversarialCheckResult,
  DoctorCertificationOptions,
  DoctorCertificationReport,
  MutationKind,
} from "./types.ts";

export async function certifyHarnessDoctor(
  options: DoctorCertificationOptions = {},
): Promise<DoctorCertificationReport> {
  const certifiedAt = parseIsoTimestamp(options.now);
  const runRoot =
    typeof options.runRoot === "string" && options.runRoot.length > 0
      ? options.runRoot
      : process.cwd();
  const minVersion =
    typeof options.minimumBunVersion === "string" && options.minimumBunVersion.length > 0
      ? options.minimumBunVersion
      : MINIMUM_BUN_VERSION;
  const bunSupported = compareSemver(Bun.version, minVersion);

  const healthChecks = await runDoctorDiagnostics(options);
  const adversarialChecks: AdversarialCheckResult[] = [];

  if (
    options.runAdversarialChecks !== false &&
    Array.isArray(options.writeScope) &&
    options.writeScope.length > 0
  ) {
    for (const scopePath of options.writeScope) {
      if (
        scopePath.endsWith(".test.ts") ||
        scopePath.endsWith(".spec.ts") ||
        options.adversarialTestRunner !== undefined
      ) {
        const mutationKind: MutationKind =
          options.mutationKind !== undefined ? options.mutationKind : "syntax_error";
        const check = await runAdversarialCounterfactualCheck(scopePath, {
          mutationKind,
          allowedRoots: [
            typeof options.repoRoot === "string" && options.repoRoot.length > 0
              ? options.repoRoot
              : findRepoRoot(),
          ],
          ...(options.adversarialTestRunner !== undefined
            ? { testRunner: options.adversarialTestRunner }
            : {}),
        });
        adversarialChecks.push(check);
      }
    }
  }

  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  for (const hc of healthChecks) {
    if (hc.status === "fail") {
      criticalIssues.push(`[${hc.category.toUpperCase()}] ${hc.name}: ${hc.message}`);
    } else if (hc.status === "warn") {
      warnings.push(`[${hc.category.toUpperCase()}] ${hc.name}: ${hc.message}`);
    }
  }

  for (const adv of adversarialChecks) {
    if (!adv.passed) {
      const advMsg = typeof adv.message === "string" ? adv.message : "Falsifiability test failed";
      criticalIssues.push(`[ADVERSARIAL] ${adv.name}: ${advMsg}`);
    }
  }

  const totalChecks = healthChecks.length + adversarialChecks.length;
  const passedHealth = healthChecks.filter((c) => c.passed).length;
  const passedAdversarial = adversarialChecks.filter((c) => c.passed).length;
  const passedChecks = passedHealth + passedAdversarial;
  const failedChecks = totalChecks - passedChecks;

  const certified = criticalIssues.length === 0 && failedChecks === 0;

  const summary = certified
    ? `Harness Doctor CERTIFIED: All ${totalChecks} health and adversarial falsifiability checks passed cleanly.`
    : `Harness Doctor UNCERTIFIED: ${criticalIssues.length} critical issue(s) detected across ${totalChecks} checks.`;

  const mdLines: string[] = [
    `# Harness Doctor Certification Report`,
    `- **Status**: ${certified ? "✅ CERTIFIED" : "❌ UNCERTIFIED"}`,
    `- **Timestamp**: ${certifiedAt}`,
    `- **Run Root**: \`${runRoot}\``,
    `- **Bun Runtime**: \`${Bun.version}\` (${bunSupported ? "Supported" : "Unsupported"})`,
    `- **Total Checks**: ${totalChecks} (Passed: ${passedChecks}, Failed: ${failedChecks})`,
    "",
    `## Health Diagnostics (${healthChecks.length})`,
  ];

  for (const hc of healthChecks) {
    const icon = hc.status === "pass" ? "✅" : hc.status === "warn" ? "⚠️" : "❌";
    mdLines.push(`- ${icon} **${hc.name}** [${hc.category}]: ${hc.message}`);
    if (hc.remediation && hc.status !== "pass") {
      mdLines.push(`  - *Remediation*: ${hc.remediation}`);
    }
  }

  mdLines.push("");
  mdLines.push(`## Adversarial Falsifiability Checks (${adversarialChecks.length})`);

  if (adversarialChecks.length === 0) {
    mdLines.push(`- _No adversarial test gates were evaluated in this cycle._`);
  } else {
    for (const adv of adversarialChecks) {
      const icon = adv.passed ? "✅" : "❌";
      const advMsg = typeof adv.message === "string" ? adv.message : "Completed";
      mdLines.push(`- ${icon} **${adv.name}**: ${advMsg}`);
      if (adv.mutation) {
        mdLines.push(
          `  - Mutation: \`${adv.mutation.mutationKind}\` applied to \`${basename(adv.targetPath)}\``,
        );
      }
    }
  }

  if (criticalIssues.length > 0) {
    mdLines.push("");
    mdLines.push(`## Critical Findings (${criticalIssues.length})`);
    for (const issue of criticalIssues) {
      mdLines.push(`- ❌ ${issue}`);
    }
  }

  const markdown = mdLines.join("\n");

  return {
    certified,
    runRoot,
    certifiedAt,
    bunVersion: Bun.version,
    bunSupported,
    healthChecks,
    adversarialChecks,
    totalChecks,
    passedChecks,
    failedChecks,
    criticalIssues,
    warnings,
    summary,
    markdown,
  };
}

export const certifyDoctorDiagnostics = certifyHarnessDoctor;

export function assertDoctorCertification(report: DoctorCertificationReport): void {
  if (!report.certified || report.criticalIssues.length > 0 || report.failedChecks > 0) {
    const detailMessage =
      report.criticalIssues.length > 0
        ? report.criticalIssues.join("; ")
        : `Certification failed with ${report.failedChecks} failing check(s)`;

    throw new HarnessError(
      "INTEGRITY",
      `Harness doctor certification failed: ${detailMessage}`,
      [...report.criticalIssues],
      3,
      "Resolve all health check issues and verify adversarial counterfactual falsifiability before proceeding.",
    );
  }
}
