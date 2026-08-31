/**
 * @file index.ts
 * Root facade for Domain 9 Installer test package
 */

export { INSTALLER_BOOTSTRAP_SUITES } from "./bootstrap/index.ts";
export { INSTALLER_ENV_SUITES } from "./env/index.ts";
export { INSTALLER_SYMLINKS_SUITES } from "./symlinks/index.ts";
export { INSTALLER_VERIFICATION_SUITES } from "./verification/index.ts";
export { cleanInstallerFixtures, installerFixture } from "./helpers.ts";

export const INSTALLER_CLUSTERS = [
  "bootstrap",
  "env",
  "symlinks",
  "verification",
] as const;
