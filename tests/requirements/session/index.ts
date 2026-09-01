/**
 * @file index.ts
 * Barrel export for requirements virtual filesystem session module.
 */

export { createRequirementsFsSpies } from "./spies.ts";
export { type VirtualRequirementsState, orig } from "./types.ts";
export {
  norm,
  isVirtualPath,
  getInode,
  makeFsStats,
  makeSymlinkStats,
  copyDirRecursive,
  handleRw,
  checkReadPermission,
} from "./handlers.ts";
