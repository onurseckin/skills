/**
 * @file index.ts
 * Barrel export for store session module.
 */

export { createStoreFsSpies } from "./spies.ts";
export { type VirtualStoreState, orig } from "./types.ts";
export {
  norm,
  isVirtualPath,
  getInode,
  makeFsStats,
  makeSymlinkStats,
  copyDirRecursive,
  handleRw,
  checkReadPermission,
  checkTraversePermission,
} from "./handlers.ts";
