/**
 * @file types.ts
 * Types and original fs references for task virtual filesystem session.
 */

import * as fs from "node:fs";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export interface VirtualTaskState {
  vfs: VirtualMemoryFS;
  openDescriptors: Map<number, { path: string; position: number; flags: number }>;
  customModes: Map<string, number>;
  customMtimes: Map<string, number>;
  inodeMap: Map<string, number>;
  symlinks: Map<string, string>;
  hardlinks: Map<string, string>;
  nextFd: number;
  nextInode: number;
}

export const orig = {
  existsSync: fs.existsSync,
  mkdirSync: fs.mkdirSync,
  writeFileSync: fs.writeFileSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  statSync: fs.statSync,
  lstatSync: fs.lstatSync,
  rmSync: fs.rmSync,
  unlinkSync: fs.unlinkSync,
  symlinkSync: fs.symlinkSync,
  readlinkSync: fs.readlinkSync,
  linkSync: fs.linkSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
  readSync: fs.readSync,
  writeSync: fs.writeSync,
  ftruncateSync: fs.ftruncateSync,
  truncateSync: fs.truncateSync,
  chmodSync: fs.chmodSync,
  fchmodSync: fs.fchmodSync,
  fstatSync: fs.fstatSync,
  realpathSync: fs.realpathSync,
  renameSync: fs.renameSync,
  cpSync: fs.cpSync,
  copyFileSync: fs.copyFileSync,
  utimesSync: fs.utimesSync,
  futimesSync: fs.futimesSync,
  appendFileSync: fs.appendFileSync,
  fsyncSync: fs.fsyncSync,
  mkdtempSync: fs.mkdtempSync,
};
