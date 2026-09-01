import { spyOn, type Mock } from "bun:test";
import * as fs from "node:fs";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  norm,
  isVirtualPath,
  makeStats,
  setCustomMode,
  transferCustomMode,
  orig,
  type OpenDescriptor,
} from "./virtual-fs-state.ts";

let vCounter = 1;

export function createSyncFsSpies(
  vfs: VirtualMemoryFS,
  openDescriptors: Map<number, OpenDescriptor>,
  spies: Mock<(...args: unknown[]) => unknown>[],
): void {
  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) => {
    const s = spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;
    spies.push(s);
    return s;
  };

  spy("existsSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    return vfs.existsSync(t) || (!isVirtualPath(t) && orig.existsSync(t));
  });

  spy("mkdirSync", (p: fs.PathLike, o?: fs.MakeDirectoryOptions | boolean) => {
    const t = norm(String(p));
    if (isVirtualPath(t) || vfs.existsSync(t)) {
      vfs.mkdirSync(t, typeof o === "boolean" ? { recursive: o } : o);
      return undefined as unknown as string;
    }
    return orig.mkdirSync(t, o);
  });

  spy(
    "writeFileSync",
    (p: fs.PathOrFileDescriptor, d: string | NodeJS.ArrayBufferView, o?: fs.WriteFileOptions) => {
      if (typeof p === "number") {
        const entry = openDescriptors.get(p);
        if (!entry) return orig.writeFileSync(p, d, o);
        vfs.writeFileSync(entry.path, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
        return;
      }
      const target = norm(String(p));
      if (isVirtualPath(target) || vfs.existsSync(target)) {
        const flag =
          typeof o === "string"
            ? o
            : typeof o === "object" && o !== null
              ? (o as { flag?: string }).flag
              : undefined;
        if ((flag === "wx" || flag === "ax" || flag === "w+x") && vfs.existsSync(target)) {
          throw Object.assign(new Error(`EEXIST: file already exists, open '${target}'`), {
            code: "EEXIST",
          });
        }
        vfs.writeFileSync(target, typeof d === "string" ? d : Buffer.from(d as Uint8Array));
        const mode = typeof o === "object" && o !== null && "mode" in o ? o.mode : undefined;
        if (typeof mode === "number") setCustomMode(target, mode);
        return;
      }
      return orig.writeFileSync(target, d, o);
    },
  );

  spy("appendFileSync", (p: fs.PathOrFileDescriptor, d: string | Uint8Array) => {
    if (typeof p === "number") {
      const entry = openDescriptors.get(p);
      if (!entry) return orig.appendFileSync(p, d);
      const cur = vfs.existsSync(entry.path) ? vfs.readFileSync(entry.path, "utf8") : "";
      vfs.writeFileSync(
        entry.path,
        cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")),
      );
      return;
    }
    const target = norm(String(p));
    if (isVirtualPath(target) || vfs.existsSync(target)) {
      const cur = vfs.existsSync(target) ? vfs.readFileSync(target, "utf8") : "";
      vfs.writeFileSync(
        target,
        cur + (typeof d === "string" ? d : Buffer.from(d).toString("utf8")),
      );
      return;
    }
    return orig.appendFileSync(p, d);
  });

  spy("readFileSync", (p: fs.PathOrFileDescriptor, o?: unknown) => {
    const enc =
      typeof o === "string"
        ? o
        : typeof o === "object" && o !== null
          ? (o as { encoding?: string }).encoding
          : undefined;
    if (typeof p === "number") {
      const entry = openDescriptors.get(p);
      if (!entry) return orig.readFileSync(p, o as BufferEncoding);
      const data = vfs.readFileSync(entry.path);
      return enc ? Buffer.from(data).toString(enc as BufferEncoding) : Buffer.from(data);
    }
    const target = norm(String(p));
    if (vfs.existsSync(target)) {
      const data = vfs.readFileSync(target);
      return enc ? Buffer.from(data).toString(enc as BufferEncoding) : Buffer.from(data);
    }
    if (orig.existsSync(target)) {
      return orig.readFileSync(p, o as BufferEncoding);
    }
    if (isVirtualPath(target)) {
      const err = new Error(`ENOENT: no such file or directory, open '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readFileSync(p, o as BufferEncoding);
  });

  spy("readdirSync", (p: fs.PathLike, o?: unknown) => {
    const target = norm(String(p));
    if (vfs.existsSync(target)) {
      const names = vfs.readdirSync(target);
      const withTypes = typeof o === "object" && (o as { withFileTypes?: boolean })?.withFileTypes;
      if (withTypes) {
        return names.map((name) => {
          const childPath = `${target.replace(/\/+$/, "")}/${name}`;
          const isDir = vfs.statSync(childPath)?.isDirectory() ?? false;
          return {
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
            isBlockDevice: () => false,
            isCharacterDevice: () => false,
            isFIFO: () => false,
            isSocket: () => false,
          } as unknown as fs.Dirent;
        });
      }
      return names as unknown as string[];
    }
    if (isVirtualPath(target)) {
      const err = new Error(`ENOENT: no such file or directory, scandir '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return orig.readdirSync(target, o as BufferEncoding);
  });

  const getStat = (p: fs.PathLike, isLstat = false): fs.Stats => {
    const target = norm(String(p));
    if (vfs.existsSync(target)) {
      const vs = vfs.statSync(target);
      if (vs) return makeStats(vs, target);
    }
    if (isVirtualPath(target)) {
      const op = isLstat ? "lstat" : "stat";
      const err = new Error(`ENOENT: no such file or directory, ${op} '${target}'`);
      (err as unknown as { code: string }).code = "ENOENT";
      throw err;
    }
    return isLstat ? orig.lstatSync(target) : orig.statSync(target);
  };
  spy("statSync", (p: fs.PathLike) => getStat(p, false));
  spy("lstatSync", (p: fs.PathLike) => getStat(p, true));

  spy("rmSync", (p: fs.PathLike, o?: fs.RmOptions) => {
    const target = norm(String(p));
    if (vfs.existsSync(target) || isVirtualPath(target)) {
      if (vfs.existsSync(target)) vfs.rmSync(target, { recursive: o?.recursive, force: o?.force });
      return;
    }
    return orig.rmSync(target, o);
  });

  spy("unlinkSync", (p: fs.PathLike) => {
    const target = norm(String(p));
    if (vfs.existsSync(target) || isVirtualPath(target)) {
      if (vfs.existsSync(target)) vfs.rmSync(target, { force: true });
      return;
    }
    return orig.unlinkSync(target);
  });

  spy("chmodSync", (p: fs.PathLike, m: fs.Mode) => {
    const t = norm(String(p));
    if (vfs.existsSync(t) || isVirtualPath(t)) setCustomMode(t, typeof m === "number" ? m : 0o644);
    else orig.chmodSync(t, m);
  });

  spy("utimesSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    if (!vfs.existsSync(t) && !isVirtualPath(t)) orig.utimesSync(t, Date.now(), Date.now());
  });

  spy("fsyncSync", () => {});

  spy("realpathSync", (p: fs.PathLike) => {
    const t = norm(String(p));
    return vfs.existsSync(t) || isVirtualPath(t) ? t : orig.realpathSync(t);
  });

  spy("renameSync", (src: fs.PathLike, dst: fs.PathLike) => {
    const s = norm(String(src));
    const d = norm(String(dst));
    if (vfs.existsSync(s) || isVirtualPath(s) || isVirtualPath(d)) {
      vfs.writeFileSync(d, vfs.readFileSync(s));
      vfs.rmSync(s, { force: true });
      transferCustomMode(s, d);
      return;
    }
    orig.renameSync(s, d);
  });

  spy("mkdtempSync", (prefix: string) => {
    const vPath = norm(`/virtual/tmp/${prefix.replace(/[^a-zA-Z0-9_-]/g, "_")}${vCounter++}`);
    vfs.mkdirSync(vPath, { recursive: true });
    return vPath;
  });
}
