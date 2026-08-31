/**
 * Workspace Resolution Subdomain Test Facade.
 * Explicit named exports for root anchors, safe paths, and canonical directories.
 */

export {
  findRepoRoot,
  isInsideCapsule,
  isTestEnvironment,
  OLT_DIR_NAME,
  OLT_FILES,
  resolveCapsulesDir,
  resolveOltDir,
  resolveScratchDir,
  stripCapsulePath,
} from "../../../olt/scripts/src/core/shared/paths.ts";

export { safeRepoPath } from "../../../olt/scripts/src/core/paths.ts";
