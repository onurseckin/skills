export { VirtualMemoryFS, normalizePosixPath, virtualFS } from "./memory/index.ts";
export { createVirtualFSSession, mockSubprocess, type VirtualFSSession } from "./spies/index.ts";

export {
  VirtualDirent,
  VirtualFSError,
  VirtualStats,
  type IVirtualFileSystem,
  type MkdirOptions,
  type ReadFileOptions,
  type ReaddirOptions,
  type RmOptions,
  type StatOptions,
  type VirtualDirNode,
  type VirtualFSNode,
  type VirtualFSSnapshot,
  type VirtualFileNode,
  type VirtualNodeType,
  type VirtualStatsInit,
  type WriteFileOptions,
} from "./core/index.ts";
