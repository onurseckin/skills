import { spyOn, type Mock } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import * as flockFfi from "../../olt/scripts/src/platform/fs/flock-ffi.ts";
import * as platform from "../../olt/scripts/src/platform/index.ts";
import * as nativeRename from "../../olt/scripts/src/installer/native-rename.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { getInode, normPath, vfsState } from "./virtual-state.ts";
import { handleRenameSync } from "./fs-handlers.ts";

export function handleFlock(fd: number): boolean {
  const entry = vfsState.openDescriptors.get(fd);
  const path = entry?.path ?? String(fd);
  const ino = getInode(path);
  const ownerFd = vfsState.inodeLockOwners.get(ino);
  if (ownerFd !== undefined && ownerFd !== fd) {
    return false;
  }
  vfsState.inodeLockOwners.set(ino, fd);
  return true;
}

export function handleReleaseFlock(fd: number): void {
  const entry = vfsState.openDescriptors.get(fd);
  const path = entry?.path ?? String(fd);
  const ino = getInode(path);
  if (vfsState.inodeLockOwners.get(ino) === fd) {
    vfsState.inodeLockOwners.delete(ino);
  }
}

export function createNativeSpies(): Array<
  Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }
> {
  return [
    spyOn(flockFfi, "loadBindings").mockImplementation((() => ({
      flock: ((descriptor: number, operation: number) => {
        if ((operation & 2) !== 0) {
          // LOCK_EX
          const ok = handleFlock(descriptor);
          if (!ok) {
            vfsState.errnoBuf[0] = process.platform === "darwin" ? 35 : 11;
            return -1;
          }
          return 0;
        }
        if ((operation & 8) !== 0) {
          // LOCK_UN
          handleReleaseFlock(descriptor);
          return 0;
        }
        return 0;
      }) as never,
      errno: (() => vfsState.errnoPtr) as never,
      handle: {},
    })) as never),
    spyOn(platform, "tryExclusiveFlock").mockImplementation(handleFlock as never),
    spyOn(platform, "releaseFlock").mockImplementation(handleReleaseFlock as never),
    spyOn(flockFfi, "tryExclusiveFlock").mockImplementation(handleFlock as never),
    spyOn(flockFfi, "releaseFlock").mockImplementation(handleReleaseFlock as never),
    spyOn(nativeRename, "renameNoReplace").mockImplementation(((
      src: string,
      dst: string,
      label: string,
    ) => {
      const srcStr = normPath(src);
      const dstStr = normPath(dst);
      if (vfsState.vfs.existsSync(dstStr) || vfsState.symlinks.has(dstStr)) {
        throw new HarnessError("INVALID_STATE", `${label} destination already exists`);
      }
      if (!vfsState.vfs.existsSync(srcStr) && !vfsState.symlinks.has(srcStr)) {
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      }
      handleRenameSync(srcStr, dstStr);
    }) as never),
    spyOn(nativeRename, "exchangePaths").mockImplementation(((
      left: string,
      right: string,
      label: string,
    ) => {
      const leftStr = normPath(left);
      const rightStr = normPath(right);
      if (!vfsState.vfs.existsSync(leftStr) || !vfsState.vfs.existsSync(rightStr)) {
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      }
      const tempStr = `${leftStr}.exchange-tmp-${Date.now()}-${Math.random()}`;
      handleRenameSync(leftStr, tempStr);
      handleRenameSync(rightStr, leftStr);
      handleRenameSync(tempStr, rightStr);
    }) as never),
    spyOn(childProcess, "spawnSync").mockImplementation(((
      cmd: string,
      args?: string[],
      opts?: { cwd?: string; encoding?: string },
    ) => {
      if (cmd === "git" && args && args[0] === "init" && opts?.cwd) {
        vfsState.vfs.mkdirSync(join(normPath(opts.cwd), ".git"), { recursive: true });
      }
      const isString = opts?.encoding === "utf-8" || opts?.encoding === "utf8";
      let text = "";
      if (args && args.includes("symbolic-ref")) text = "main\n";
      else if (args && args.includes("rev-parse")) text = "a".repeat(40) + "\n";
      else if (args && args.includes("status")) text = "";
      else text = "main\n";

      return {
        status: 0,
        stdout: isString ? text : Buffer.from(text),
        stderr: isString ? "" : Buffer.from(""),
        output: [null, isString ? text : Buffer.from(text), isString ? "" : Buffer.from("")],
        pid: 1234,
        signal: null,
        error: undefined,
      };
    }) as never),
  ];
}
