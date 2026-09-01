import { spyOn, type Mock } from "bun:test";
import * as fsPromises from "node:fs/promises";
import type * as fs from "node:fs";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { norm, isVirtualPath, setCustomMode, orig } from "./virtual-fs-state.ts";

let vAsyncCounter = 1;

export function createAsyncFsSpies(
  vfs: VirtualMemoryFS,
  spies: Mock<(...args: unknown[]) => unknown>[],
): void {
  const spyP = <K extends keyof typeof fsPromises>(k: K, fn: unknown) => {
    const s = spyOn(fsPromises, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;
    spies.push(s);
    return s;
  };

  spyP("mkdir", async (p: fs.PathLike, o?: fs.MakeDirectoryOptions | boolean) => {
    const t = norm(String(p));
    if (isVirtualPath(t) || vfs.existsSync(t)) {
      vfs.mkdirSync(t, typeof o === "boolean" ? { recursive: o } : o);
      return undefined;
    }
    return orig.mkdir(t, o as never);
  });

  spyP("mkdtemp", async (prefix: string) => {
    const vPath = norm(`/virtual/tmp/${prefix.replace(/[^a-zA-Z0-9_-]/g, "_")}${vAsyncCounter++}`);
    vfs.mkdirSync(vPath, { recursive: true });
    return vPath;
  });

  spyP(
    "writeFile",
    async (
      p: fs.PathOrFileDescriptor | fsPromises.FileHandle,
      d: string | NodeJS.ArrayBufferView,
      o?: fs.WriteFileOptions,
    ) => {
      const t = norm(String(p));
      if (isVirtualPath(t) || vfs.existsSync(t)) {
        vfs.writeFileSync(t, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
        const mode = typeof o === "object" && o !== null && "mode" in o ? o.mode : undefined;
        if (typeof mode === "number") setCustomMode(t, mode);
        return;
      }
      return orig.writeFile(t, d, o);
    },
  );

  spyP("readFile", async (p: fs.PathOrFileDescriptor | fsPromises.FileHandle, o?: unknown) => {
    const t = norm(String(p));
    const enc =
      typeof o === "string"
        ? o
        : typeof o === "object" && o !== null
          ? (o as { encoding?: string }).encoding
          : undefined;
    if (vfs.existsSync(t)) {
      const data = vfs.readFileSync(t);
      return (enc ? Buffer.from(data).toString(enc as BufferEncoding) : Buffer.from(data)) as never;
    }
    if (isVirtualPath(t)) {
      const err = new Error(`ENOENT: no such file or directory, open '${t}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readFile(t, o as BufferEncoding) as never;
  });

  spyP("rm", async (p: fs.PathLike, o?: fs.RmOptions) => {
    const t = norm(String(p));
    if (vfs.existsSync(t) || isVirtualPath(t)) {
      if (vfs.existsSync(t)) vfs.rmSync(t, { recursive: o?.recursive, force: o?.force });
      return;
    }
    return orig.rm(t, o);
  });
}
