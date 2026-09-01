import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import * as platform from "../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import { makeHandlers, type VirtualFsState, orig } from "./virtual-fs-handlers.ts";

export { orig, type VirtualFsState };

export function createFsSpies(s: VirtualFsState): Mock<(...args: unknown[]) => unknown>[] {
  const h = makeHandlers(s);
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;
  return [
    spy("existsSync", h.exists),
    spy("mkdirSync", h.mkdir),
    spy("writeFileSync", h.write),
    spy("readFileSync", h.read),
    spy("readdirSync", h.readdir),
    spy("statSync", h.stat),
    spy("lstatSync", h.lstat),
    spy("rmSync", h.rm),
    spy("unlinkSync", h.unlink),
    spy("symlinkSync", h.symlink),
    spy("linkSync", h.link),
    spy("openSync", h.open),
    spy("closeSync", h.close),
    spy("readSync", h.readSync),
    spy("writeSync", h.writeSync),
    spy("fsyncSync", h.fsync),
    spy("fstatSync", h.fstat),
    spy("realpathSync", h.realpath),
    spy("renameSync", h.rename),
    spy("chmodSync", h.chmod),
    spy("utimesSync", h.utimes),
    spy("appendFileSync", h.appendFile),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}) as never,
  ];
}
