/**
 * Workspace Engine Subdomain Test Facade.
 * Explicit named exports for workspace engine integration and static invariant checking.
 */

export { findRepoRoot, resolveOltDir, resolveCapsulesDir } from "../resolution/index.ts";
export { CAPSULE_LAYOUT, checkManifest } from "../layout/index.ts";
export { withRunLock } from "../isolation/index.ts";
