/**
 * @file index.ts
 * Barrel export for task virtual filesystem session module.
 */

export { createTaskFsSpies } from "./spies.ts";
export { type VirtualTaskState, orig } from "./types.ts";
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
