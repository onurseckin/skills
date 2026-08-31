/**
 * Virtual In-Memory Filesystem Module.
 * Provides zero-disk sandboxed POSIX filesystem emulation for testing and simulation.
 */

export { VirtualMemoryFS, normalizePosixPath, virtualFS } from "./memory-fs.ts";

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
  type VirtualFSSnapshot,
  type VirtualFSNode,
  type VirtualFileNode,
  type VirtualNodeType,
  type VirtualStatsInit,
  type WriteFileOptions,
} from "./types.ts";
