import { HarnessError } from "../../core/errors/index.ts";
import { loadRepoPolicy } from "../../policy/index.ts";
import {
  evaluateViewportCoverage,
  getResponsiveViewportMatrix,
} from "./viewport-matrix.ts";
import {
  syncPersonasWithDockerPolicy,
  validatePersonaGovernance,
} from "./persona-governance.ts";
import type {
  CaptureGovernanceReport,
  GovernanceSyncOptions,
  ViewportGovernanceSyncResult,
} from "./types.ts";

export function auditCaptureGovernance(
  options: GovernanceSyncOptions = {},
): CaptureGovernanceReport {
  const policy = options.policy !== undefined ? options.policy : loadRepoPolicy();
  const violations: string[] = [];

  let viewportStatus: ViewportGovernanceSyncResult;
  const config = options.config;
  if (config !== undefined && config.viewports !== undefined) {
    const rawViewports = Object.values(config.viewports);
    viewportStatus = evaluateViewportCoverage(rawViewports);
  } else {
    const canonicalSpecs = getResponsiveViewportMatrix();
    viewportStatus = evaluateViewportCoverage(canonicalSpecs);
  }

  if (!viewportStatus.valid) {
    violations.push(
      `Viewport governance violation: missing mandatory tiers [${viewportStatus.missingTiers.join(", ")}]. Full 4-tier matrix required (1920x1080, 1440x900, 768x1024, 390x844).`,
    );
  }

  const personaStatus =
    config !== undefined && config.auth !== undefined
      ? syncPersonasWithDockerPolicy(policy, config)
      : validatePersonaGovernance(policy);

  if (!personaStatus.synchronized) {
    for (const diff of personaStatus.diffs) {
      violations.push(`Persona governance drift: ${diff}`);
    }
  }

  return {
    compliant: violations.length === 0,
    viewportStatus,
    personaStatus,
    violations,
    timestamp: new Date().toISOString(),
  };
}

export function synchronizeCaptureGovernance(
  options: GovernanceSyncOptions = {},
): CaptureGovernanceReport {
  return auditCaptureGovernance(options);
}

export function assertCaptureGovernanceCompliance(
  options: GovernanceSyncOptions = {},
): void {
  const report = auditCaptureGovernance(options);
  if (!report.compliant) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Capture governance compliance verification failed:\n- ${report.violations.join("\n- ")}`,
    );
  }
}
