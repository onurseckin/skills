/**
 * @file index.ts
 * Facade for Installer Verification & Integrity test suites
 */

export const INSTALLER_VERIFICATION_SUITES = [
  "identity",
  "manifest-integrity",
  "path-safety",
  "source-validation",
  "installation-status",
  "runtime-freshness-detection",
  "runtime-freshness-assertion",
  "parity",
] as const;
