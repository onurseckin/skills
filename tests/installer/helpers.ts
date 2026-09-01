export {
  vfsState,
  normPath,
  resolveVirtualPath,
  isVirtualInstallerPath,
  getInode,
  registerSpecialFile,
} from "./virtual-state.ts";

export { checkAncestorAccess, checkWriteAccess, makeInstallerStats } from "./virtual-stats.ts";

export {
  copyDirRecursive,
  handleOpenSync,
  handleReadSync,
  handleWriteSync,
  handleLstat,
  handleStat,
  handleRenameSync,
  handleCreateSymlink,
} from "./fs-handlers.ts";

export { createSyncFsSpies } from "./fs-sync-spies.ts";
export { createAsyncFsSpies } from "./fs-async-spies.ts";

export { handleFlock, handleReleaseFlock, createNativeSpies } from "./native-spies.ts";

export {
  setupVirtualInstallerFS,
  cleanupVirtualInstallerFS,
  installerFixture,
  cleanInstallerFixtures,
  getVirtualInstallerFS,
} from "./fixtures.ts";
