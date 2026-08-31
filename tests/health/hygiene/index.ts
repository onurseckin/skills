/**
 * Health Hygiene Subdomain Test Facade.
 * Explicit named exports for root hygiene scanning, quarantine engine, and integrity checks.
 */

export {
  scanRootHygiene,
  quarantineViolations,
  assertCleanRootHygiene,
  RootHygieneEngine,
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  DEFAULT_ALLOWED_ROOT_DIRS,
  DEFAULT_ALLOWED_ROOT_FILES,
  type HygieneViolation,
  type HygieneScanResult,
  type QuarantineRecord,
} from "../../../olt/scripts/src/health/hygiene/index.ts";
