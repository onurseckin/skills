/**
 * @file index.ts
 * Facade for Installer Bootstrap & Atomic Transaction test suites
 */

export const INSTALLER_BOOTSTRAP_SUITES = [
  "install",
  "transaction-marker",
  "release-copy",
  "release-actions-commit",
  "release-actions-lifecycle",
  "release-transaction-recovery",
  "release-transaction-lifecycle",
  "release-recovery-core",
  "release-recovery-journal",
] as const;
