/**
 * @file index.ts
 * Barrel export for defects virtual filesystem session module.
 */

export { createDefectsFsSpies } from "./spies.ts";
export { type VirtualDefectsState, orig } from "./types.ts";
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
