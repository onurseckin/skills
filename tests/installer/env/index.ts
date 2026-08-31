/**
 * @file index.ts
 * Facade for Installer Environment & Host Integration test suites
 */

export const INSTALLER_ENV_SUITES = [
  "platform",
  "install-roots",
  "shell-rc",
  "bin-export",
  "stable-file",
  "durable-tree",
  "installer-lock",
] as const;
