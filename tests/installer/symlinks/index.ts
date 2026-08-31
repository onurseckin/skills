/**
 * @file index.ts
 * Facade for Installer Symlinks & Path Mutations test suites
 */

export const INSTALLER_SYMLINKS_SUITES = [
  "client-links",
  "bound-mutations",
  "native-rename",
  "journaled-removal",
  "recovery-errors",
] as const;
