export { SyntheticClock } from "./clock.ts";
export { VirtualDirent, VirtualStats } from "./descriptors.ts";
export type { VirtualDirNode, VirtualFileNode, VirtualFSNode } from "./descriptors.ts";
export { VirtualFSError } from "./errors.ts";
export { ChatVirtualFS, normalizePosixPath } from "./memory-fs.ts";
export { SyntheticPidTable } from "./pid-table.ts";
export { createDirNode, lookupNode, rebasePath, resolveParent } from "./tree.ts";
export type {
  ChatFSDirent,
  ChatFSStats,
  ChatVirtualFSSnapshot,
  IVirtualFSWatcher,
  MkdirOptions,
  ProcessRecord,
  ProcessSpawnOptions,
  ReadFileOptions,
  ReaddirOptions,
  RmOptions,
  StatOptions,
  VirtualStatsOptions,
  WatchEventType,
  WatchListener,
  WatchOptions,
  WriteFileOptions,
} from "./types.ts";
export { VirtualWatcher } from "./watcher.ts";
