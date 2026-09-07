export type {
  IVirtualFileSystem,
  MkdirOptions,
  ReadFileOptions,
  ReaddirOptions,
  RmOptions,
  StatOptions,
  VirtualDirNode,
  VirtualFSNode,
  VirtualFSSnapshot,
  VirtualFileNode,
  VirtualNodeType,
  VirtualStatsInit,
  WriteFileOptions,
} from "./types.ts";

export { VirtualDirent, VirtualFSError, VirtualStats } from "./types.ts";

export {
  mockOpen,
  mockRead,
  mockSpawnSync,
  mockWrite,
  origCloseSync,
  origOpenSync,
  origReadSync,
  origWriteSync,
} from "./descriptors.ts";

export type { VirtualFSSpyState } from "./handlers-base.ts";

export {
  NOOP_FALSE,
  checkParentExec,
  checkRmPermissions,
  fsErr,
  forgetInode,
  getInode,
  isVirtualPath,
  makeFsStats,
  normPath,
  origClose,
  origExists,
  origFstat,
  origLstat,
  origOpendir,
  origRead,
  origReaddir,
  origRealpath,
  origStat,
  remapPrefix,
} from "./handlers-base.ts";

export {
  copyDirRecursive,
  mockCp,
  mockLink,
  mockOpendir,
  mockRename,
  origCopyFile,
} from "./handlers-io.ts";

export {
  mockExists,
  mockLstat,
  mockMkdir,
  mockReadFile,
  mockReaddir,
  mockStat,
  mockWriteFile,
} from "./handlers.ts";
