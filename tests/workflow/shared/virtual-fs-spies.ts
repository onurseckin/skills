import { spyOn, type Mock } from "bun:test";
import * as ts from "typescript";
import * as platform from "../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  norm,
  isVirtualPath,
  resetInodeMap,
  orig,
  type OpenDescriptor,
} from "./virtual-fs-state.ts";
import { createSyncFsSpies } from "./virtual-fs-sync-spies.ts";
import { createFdFsSpies } from "./virtual-fs-fd-spies.ts";
import { createAsyncFsSpies } from "./virtual-fs-async-spies.ts";

export function createWorkflowFsSpies(
  vfs: VirtualMemoryFS,
  openDescriptors: Map<number, OpenDescriptor>,
): { spies: Mock<(...args: unknown[]) => unknown>[]; cleanup: () => void } {
  const spies: Mock<(...args: unknown[]) => unknown>[] = [];

  createSyncFsSpies(vfs, openDescriptors, spies);
  createFdFsSpies(vfs, openDescriptors, spies);
  createAsyncFsSpies(vfs, spies);

  ts.sys.readFile = (f: string, e?: string) =>
    vfs.existsSync(norm(f))
      ? vfs.readFileSync(norm(f), (e as BufferEncoding) ?? "utf8")
      : orig.tsReadFile(f, e);
  ts.sys.fileExists = (f: string) =>
    vfs.existsSync(norm(f)) || (!isVirtualPath(norm(f)) && orig.tsFileExists(f));
  ts.sys.directoryExists = (d: string) =>
    vfs.existsSync(norm(d))
      ? (vfs.statSync(norm(d))?.isDirectory() ?? false)
      : !isVirtualPath(norm(d)) && orig.tsDirectoryExists(d);
  ts.sys.getDirectories = (d: string) => orig.tsGetDirectories(d);
  ts.sys.readDirectory = (
    p: string,
    ext?: readonly string[],
    ex?: readonly string[],
    inc?: readonly string[],
    d?: number,
  ) => orig.tsReadDirectory(p, ext, ex, inc, d);

  spies.push(
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}) as never,
  );

  const cleanup = () => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
    openDescriptors.clear();
    resetInodeMap();
    ts.sys.readFile = orig.tsReadFile;
    ts.sys.fileExists = orig.tsFileExists;
    ts.sys.directoryExists = orig.tsDirectoryExists;
    ts.sys.getDirectories = orig.tsGetDirectories;
    ts.sys.readDirectory = orig.tsReadDirectory;
  };

  return { spies, cleanup };
}
