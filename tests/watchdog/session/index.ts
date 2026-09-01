/**
 * @file index.ts
 * Barrel export for watchdog virtual filesystem session module.
 */

export { createWatchdogFsSpies } from "./spies.ts";
export { type VirtualWatchdogState, orig } from "./types.ts";
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
