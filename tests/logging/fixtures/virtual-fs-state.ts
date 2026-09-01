import * as fs from "node:fs";
import type {
  VirtualMemoryFS,
  VirtualStats,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const orig = {
  exists: fs.existsSync.bind(fs),
  read: fs.readFileSync.bind(fs),
  write: fs.writeFileSync.bind(fs),
  mkdir: fs.mkdirSync.bind(fs),
  readdir: fs.readdirSync.bind(fs),
  stat: fs.statSync.bind(fs),
  lstat: fs.lstatSync.bind(fs),
  rm: fs.rmSync.bind(fs),
  unlink: fs.unlinkSync.bind(fs),
  symlink: fs.symlinkSync.bind(fs),
  link: fs.linkSync.bind(fs),
  open: fs.openSync.bind(fs),
  close: fs.closeSync.bind(fs),
  fstat: fs.fstatSync.bind(fs),
  readSync: fs.readSync.bind(fs),
  writeSync: fs.writeSync.bind(fs),
  fsync: fs.fsyncSync.bind(fs),
  realpath: fs.realpathSync.bind(fs),
  rename: fs.renameSync.bind(fs),
  chmod: fs.chmodSync.bind(fs),
  utimes: fs.utimesSync.bind(fs),
  appendFile: fs.appendFileSync.bind(fs),
};

export interface VirtualFsState {
  vfs: VirtualMemoryFS;
  openDescriptors: Map<number, { path: string; position: number; flags: number }>;
  nextFd: () => number;
  customModes: Map<string, number>;
  customMtimes: Map<string, number>;
  symlinks: Map<string, string>;
  hardlinks: Map<string, string>;
  isVirtualPath: (p: string) => boolean;
  makeStats: (vStats: VirtualStats, targetPath: string, isSymlink?: boolean) => fs.Stats;
  norm: (p: string) => string;
  getInode: (p: string) => number;
}

export function noent(op: string, p: string): never {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${p}'`);
  (err as unknown as { code: string }).code = "ENOENT";
  throw err;
}
