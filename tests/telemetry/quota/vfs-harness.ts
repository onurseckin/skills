import { spyOn } from "bun:test";
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";

export interface VirtualNode {
  isDir: boolean;
  content?: string;
  mode?: number;
  ino: number;
}

const strData = (d: string | NodeJS.ArrayBufferView) =>
  typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array);

function getDirents(vfs: Map<string, VirtualNode>, pref: string, isBuf = false): fs.Dirent[] {
  const ent = new Map<string, boolean>();
  for (const k of vfs.keys()) {
    if (k.startsWith(pref)) {
      const p0 = k.slice(pref.length).split("/")[0];
      if (p0)
        ent.set(
          p0,
          (ent.get(p0) ?? false) ||
            k.length > pref.length + p0.length ||
            vfs.get(k)?.isDir === true,
        );
    }
  }
  return Array.from(ent.entries()).map(([name, isDir]) => ({
    name: isBuf ? (Buffer.from(name) as unknown as string) : name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
  })) as unknown as fs.Dirent[];
}

async function fspOpenMock(self: QuotaVirtualFs, p: fs.PathLike): Promise<fsp.FileHandle> {
  const s = String(p),
    n = self.vfs.get(s);
  if (!n || n.content === undefined) {
    const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  }
  const buf = Buffer.from(n.content);
  return {
    stat: async (opt?: { bigint?: boolean }) =>
      opt?.bigint ? self.toBig(self.getStats(s, false)) : self.getStats(s, false),
    read: async (b: Buffer, off = 0, len = b.length, pos = 0) => {
      const slice = buf.subarray(pos, pos + len);
      slice.copy(b, off);
      return { bytesRead: slice.length, buffer: b };
    },
    close: async () => {},
  } as unknown as fsp.FileHandle;
}

function mockSyncHandlers(self: QuotaVirtualFs): void {
  const m = <T extends object, K extends keyof T>(t: T, k: K, fn: T[K]) =>
    self.spies.push(spyOn(t, k as never).mockImplementation(fn as never));

  m(flockFfi, "tryExclusiveFlock", () => true);
  m(flockFfi, "releaseFlock", () => {});
  m(
    fs,
    "existsSync",
    (p: fs.PathLike) =>
      self.vfs.has(String(p).replace(/\/+$/, "")) ||
      Array.from(self.vfs.keys()).some((k) => k.startsWith(`${String(p).replace(/\/+$/, "")}/`)) ||
      (String(p).startsWith(process.cwd()) && self.origExists(String(p))),
  );
  m(fs, "statSync", (p: fs.PathLike) => self.getStats(p, false));
  m(fs, "lstatSync", (p: fs.PathLike) => self.getStats(p, true));
  m(fs, "fstatSync", (fd: number) => self.getStats(self.openedFds.get(Number(fd)) ?? "", false));
  m(fs, "realpathSync", (p: fs.PathLike) => String(p));
  m(fs, "mkdirSync", (p: fs.PathLike) => {
    if (!self.vfs.has(String(p))) self.vfs.set(String(p), { isDir: true, ino: ++self.nextIno });
    return undefined;
  });
  m(fs, "openSync", (p: fs.PathLike) => {
    const fd = ++self.nextFd;
    self.openedFds.set(fd, String(p));
    self.fdOffsets.set(fd, 0);
    return fd;
  });
  m(fs, "closeSync", (fd: number) => {
    self.openedFds.delete(Number(fd));
    self.fdOffsets.delete(Number(fd));
    return undefined;
  });
  m(fs, "fsyncSync", () => undefined);
  m(fs, "chmodSync", (p: fs.PathLike, mode: number) => {
    const n = self.vfs.get(String(p));
    if (n) n.mode = Number(mode);
  });
  m(fs, "unlinkSync", (p: fs.PathLike) => {
    self.vfs.delete(String(p));
  });
  m(fs, "rmSync", (p: fs.PathLike) => {
    const s = String(p).replace(/\/+$/, "");
    for (const k of Array.from(self.vfs.keys()))
      if (k === s || k.startsWith(`${s}/`)) self.vfs.delete(k);
  });
  m(cp, "spawnSync", (_cmd: unknown, args: unknown, opts: unknown) => {
    const list = Array.isArray(args) ? args.map(String) : [];
    const cIdx = list.indexOf("-C");
    const cwd =
      cIdx !== -1 && list[cIdx + 1]
        ? list[cIdx + 1]
        : typeof opts === "object" && opts !== null && "cwd" in opts
          ? String((opts as { cwd?: string }).cwd)
          : "/virtual/repo";
    let status = 0,
      out = "";
    if (list.includes("--get-regexp") || list.includes("--null")) {
      status = 1;
      out = "";
    } else if (list.includes("--is-inside-work-tree")) out = "true\n";
    else if (list.includes("config.worktree")) out = `${cwd}/.git/config.worktree\n`;
    else if (list.includes("--absolute-git-dir") || list.includes("--git-common-dir"))
      out = `${cwd}/.git\n`;
    else if (list.includes("HEAD") && list.includes("rev-parse"))
      out = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    else if (list.includes("symbolic-ref")) out = "refs/heads/main\n";
    const isString = typeof opts === "object" && opts !== null && "encoding" in opts && Boolean((opts as { encoding?: string }).encoding);
    return {
      status,
      stdout: isString ? out : Buffer.from(out),
      stderr: isString ? "" : Buffer.alloc(0),
      pid: 1234,
      output: [null, isString ? out : Buffer.from(out), isString ? "" : Buffer.alloc(0)],
      signal: null,
    };
  });
  m(fs, "renameSync", (o: fs.PathLike, n: fs.PathLike) => {
    const op = String(o),
      np = String(n),
      pref = `${op}/`;
    for (const [k, v] of Array.from(self.vfs.entries())) {
      if (k === op) {
        self.vfs.set(np, { ...v });
        self.vfs.delete(k);
      } else if (k.startsWith(pref)) {
        self.vfs.set(`${np}/${k.slice(pref.length)}`, { ...v });
        self.vfs.delete(k);
      }
    }
  });
  m(fs, "writeFileSync", (p: fs.PathLike, d: string | NodeJS.ArrayBufferView) => {
    self.vfs.set(String(p), {
      content: strData(d),
      isDir: false,
      ino: self.vfs.get(String(p))?.ino ?? ++self.nextIno,
    });
  });
  m(fs, "appendFileSync", (p: fs.PathLike, d: string | NodeJS.ArrayBufferView) => {
    self.vfs.set(String(p), {
      content: (self.vfs.get(String(p))?.content ?? "") + strData(d),
      isDir: false,
      ino: self.vfs.get(String(p))?.ino ?? ++self.nextIno,
    });
  });
  m(fs, "readFileSync", (p: fs.PathLike, opt: unknown) => {
    const s =
        typeof p === "number" || /^\d+$/.test(String(p))
          ? (self.openedFds.get(Number(p)) ?? String(p))
          : String(p),
      n = self.vfs.get(s);
    if (n?.content !== undefined) {
      const enc =
        typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
      return enc === "utf-8" || enc === "utf8"
        ? n.content
        : (Buffer.from(n.content) as unknown as string);
    }
    if (s.startsWith(process.cwd()) && self.origExists(s))
      return self.origRead(s, opt as { encoding?: BufferEncoding });
    const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  });
  m(fs, "readdirSync", (p: fs.PathLike, opt: unknown) => {
    const s = String(p).replace(/\/+$/, ""),
      pref = `${s}/`,
      wt =
        typeof opt === "object" &&
        (opt as { withFileTypes?: boolean } | null)?.withFileTypes === true;
    if (
      !Array.from(self.vfs.keys()).some((k) => k.startsWith(pref)) &&
      s.startsWith(process.cwd()) &&
      self.origExists(s)
    )
      return self.origReaddir(s, opt as { withFileTypes?: boolean }) as unknown as string[];
    const dirents = getDirents(self.vfs, pref);
    return (wt ? dirents : dirents.map((d) => d.name)) as unknown as string[];
  });
  m(fs, "readSync", (fd: number, buf: Buffer, off: number, len: number, pos: number | null) => {
    const p = self.openedFds.get(Number(fd)),
      n = p ? self.vfs.get(p) : undefined;
    if (!n || n.content === undefined) return 0;
    const data = Buffer.from(n.content, "utf8"),
      at = pos === null || pos === undefined ? (self.fdOffsets.get(Number(fd)) ?? 0) : Number(pos);
    if (at >= data.length) return 0;
    const bytes = Math.min(Number(len), data.length - at);
    data.copy(buf, Number(off), at, at + bytes);
    if (pos === null || pos === undefined) self.fdOffsets.set(Number(fd), at + bytes);
    return bytes;
  });
  m(fs, "writeSync", (fd: number, buf: unknown, off: number, len: number) => {
    const p = self.openedFds.get(Number(fd));
    if (!p) return 0;
    const str = strData(buf as NodeJS.ArrayBufferView),
      ex = self.vfs.get(p);
    self.vfs.set(p, {
      content: (ex?.content ?? "") + str,
      isDir: false,
      ino: ex?.ino ?? ++self.nextIno,
      mode: ex?.mode,
    });
    return typeof buf === "string"
      ? Buffer.byteLength(str)
      : Number(len ?? (buf as Uint8Array).byteLength);
  });
  m(fs, "opendirSync", (p: fs.PathLike, opt: unknown) => {
    const pref = `${String(p).replace(/\/+$/, "")}/`,
      isBuf =
        typeof opt === "object" && (opt as { encoding?: string } | null)?.encoding === "buffer";
    const dirents = getDirents(self.vfs, pref, isBuf);
    let idx = 0;
    return {
      readSync: () => (dirents[idx++] ?? null) as unknown as fs.Dirent,
      closeSync: () => undefined,
      [Symbol.iterator]: function* () {
        while (idx < dirents.length) yield dirents[idx++] as unknown as fs.Dirent;
      },
    } as unknown as fs.Dir;
  });
  m(fsp, "lstat", (async (p: fs.PathLike, opt: { bigint?: boolean }) =>
    opt?.bigint ? self.toBig(self.getStats(p, true)) : self.getStats(p, true)) as never);
  m(fsp, "open", ((p: fs.PathLike) => fspOpenMock(self, p)) as never);
}

export class QuotaVirtualFs {
  readonly vfs = new Map<string, VirtualNode>();
  readonly openedFds = new Map<number, string>();
  readonly fdOffsets = new Map<number, number>();
  readonly spies: Array<{ mockRestore: () => void }> = [];
  nextIno = 1000;
  nextFd = 100;

  readonly origExists = fs.existsSync.bind(fs);
  readonly origRead = fs.readFileSync.bind(fs);
  readonly origStat = fs.statSync.bind(fs);
  readonly origLstat = fs.lstatSync.bind(fs);
  readonly origReaddir = fs.readdirSync.bind(fs);

  setFile(p: string, content = "", isDir = false, mode?: number): void {
    this.vfs.set(p, { isDir, content, mode, ino: ++this.nextIno });
  }

  getStats(p: fs.PathLike, isLstat: boolean): fs.Stats {
    const s = String(p).replace(/\/+$/, "");
    let n = this.vfs.get(s);
    if (!n && Array.from(this.vfs.keys()).some((k) => k.startsWith(`${s}/`))) {
      n = { isDir: true, ino: ++this.nextIno };
      this.vfs.set(s, n);
    }
    if (n) {
      return {
        dev: 1,
        ino: n.ino,
        nlink: 1,
        uid: 501,
        gid: 20,
        isFile: () => !n.isDir,
        isDirectory: () => n.isDir,
        isSymbolicLink: () => false,
        mode: n.mode ?? (n.isDir ? 0o755 : 0o644),
        size: n.content ? Buffer.byteLength(n.content) : 0,
        mtimeMs: 1700000000000,
        ctimeMs: 1700000000000,
      } as fs.Stats;
    }
    if (s.startsWith(process.cwd())) return isLstat ? this.origLstat(s) : this.origStat(s);
    const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  }

  toBig(st: fs.Stats): fs.BigIntStats {
    return {
      ...st,
      dev: BigInt(st.dev),
      ino: BigInt(st.ino),
      mode: BigInt(st.mode),
      nlink: BigInt(st.nlink),
      uid: BigInt(st.uid),
      gid: BigInt(st.gid),
      size: BigInt(st.size),
      mtimeNs: BigInt(st.mtimeMs) * 1000000n,
    } as unknown as fs.BigIntStats;
  }

  setup(): void {
    this.cleanup();
    mockSyncHandlers(this);
  }

  cleanup(): void {
    for (const s of this.spies.splice(0)) s.mockRestore();
    this.vfs.clear();
    this.openedFds.clear();
    this.fdOffsets.clear();
    this.nextIno = 1000;
    this.nextFd = 100;
  }
}
