/**
 * Health Reporting Subdomain Test Facade.
 * Explicit named exports for report formatting, runner orchestration, and structural assertions.
 */

export {
  renderHealthReport,
} from "../../../olt/scripts/src/health/report.ts";

export {
  runHealthCheck,
  defaultLayout,
  type HealthLayout,
} from "../../../olt/scripts/src/health/index.ts";

export {
  finding,
  advisory,
  type HealthCheckId,
  type HealthCheckResult,
  type HealthFinding,
  type HealthReport,
  type HealthSeverity,
  type SkippedCheck,
} from "../../../olt/scripts/src/health/types.ts";
