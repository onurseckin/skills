import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";

export interface VirtualNode {
  isDir: boolean;
  content?: string;
  nlink?: number;
  isSymlink?: boolean;
  symlinkTarget?: string;
  ino: number;
}

export class SnapshotVirtualFs {
  readonly vfs = new Map<string, VirtualNode>();
  readonly openedFds = new Map<number, string>();
  readonly spies: Array<{ mockRestore: () => void }> = [];
  nextIno = 1000;
  nextFd = 100;

  setFile(p: string, content = "", isDir = false): void {
    this.vfs.set(p, { isDir, content, ino: ++this.nextIno });
  }

  getStats(p: fs.PathLike, isLstat: boolean): fs.Stats {
    const s = String(p).replace(/\/+$/, "");
    let n = this.vfs.get(s);
    if (!n) {
      if (Array.from(this.vfs.keys()).some((k) => k.startsWith(`${s}/`))) {
        n = { isDir: true, ino: ++this.nextIno };
        this.vfs.set(s, n);
      } else {
        const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
    }
    const isSym = n.isSymlink === true;
    return {
      dev: 1,
      ino: n.ino,
      nlink: n.nlink ?? 1,
      uid: 501,
      gid: 20,
      isFile: () => !n.isDir && (!isSym || !isLstat),
      isDirectory: () => n.isDir && (!isSym || !isLstat),
      isSymbolicLink: () => isSym && isLstat,
      mode: n.isDir ? 0o755 : 0o644,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  }

  setup(): void {
    this.cleanup();
    this.setFile(process.cwd(), "", true);
    this.setFile(join(process.cwd(), ".git"), "", true);
    this.setFile(join(process.cwd(), "package.json"), "{}");

    const m = <T extends object, K extends keyof T>(t: T, k: K, fn: T[K]) =>
      this.spies.push(spyOn(t, k as never).mockImplementation(fn as never));

    m(fs, "existsSync", (p: fs.PathLike) => {
      const s = String(p).replace(/\/+$/, "");
      return this.vfs.has(s) || Array.from(this.vfs.keys()).some((k) => k.startsWith(`${s}/`));
    });
    m(fs, "statSync", (p: fs.PathLike) => this.getStats(p, false));
    m(fs, "lstatSync", (p: fs.PathLike) => this.getStats(p, true));
    m(fs, "fstatSync", (fd: number) => this.getStats(this.openedFds.get(Number(fd)) ?? "", false));
    m(fs, "realpathSync", (p: fs.PathLike) => String(p));
    m(fs, "readFileSync", (p: fs.PathLike, options: unknown) => {
      const s =
        typeof p === "number" || /^\d+$/.test(String(p))
          ? (this.openedFds.get(Number(p)) ?? String(p))
          : String(p);
      const n = this.vfs.get(s);
      if (!n || n.content === undefined) {
        const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
        err.code = "ENOENT";
        throw err;
      }
      const enc =
        typeof options === "string"
          ? options
          : (options as { encoding?: string } | undefined)?.encoding;
      return enc === "utf-8" || enc === "utf8"
        ? n.content
        : (Buffer.from(n.content) as unknown as string);
    });
    m(fs, "writeFileSync", (p: fs.PathLike, data: string | Uint8Array) => {
      const s = String(p),
        existing = this.vfs.get(s);
      const str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
      this.vfs.set(s, { content: str, isDir: false, ino: existing?.ino ?? ++this.nextIno });
    });
    m(fs, "writeSync", (fd: number, data: string | Uint8Array) => {
      const p = this.openedFds.get(Number(fd));
      if (p) {
        const str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
        const existing = this.vfs.get(p);
        this.vfs.set(p, { content: str, isDir: false, ino: existing?.ino ?? ++this.nextIno });
      }
      return 1;
    });
    m(fs, "appendFileSync", (p: fs.PathLike, data: string | Uint8Array) => {
      const s = String(p),
        str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
      const existing = this.vfs.get(s);
      this.vfs.set(s, {
        content: (existing?.content ?? "") + str,
        isDir: false,
        ino: existing?.ino ?? ++this.nextIno,
      });
    });
    m(fs, "mkdirSync", (p: fs.PathLike) => {
      const s = String(p);
      if (!this.vfs.has(s)) this.vfs.set(s, { isDir: true, ino: ++this.nextIno });
      return undefined;
    });
    m(fs, "openSync", (p: fs.PathLike) => {
      const fd = ++this.nextFd;
      this.openedFds.set(fd, String(p));
      return fd;
    });
    m(fs, "closeSync", (fd: number) => {
      this.openedFds.delete(Number(fd));
      return undefined;
    });
    m(fs, "fsyncSync", () => undefined);
    m(fs, "chmodSync", () => undefined);
    m(fs, "renameSync", (oldPath: fs.PathLike, newPath: fs.PathLike) => {
      const oldNode = this.vfs.get(String(oldPath));
      if (oldNode) {
        this.vfs.set(String(newPath), { ...oldNode });
        this.vfs.delete(String(oldPath));
      }
    });
    m(fs, "unlinkSync", (p: fs.PathLike) => {
      this.vfs.delete(String(p));
    });
    m(fs, "symlinkSync", (target: fs.PathLike, p: fs.PathLike) => {
      this.vfs.set(String(p), {
        isDir: false,
        isSymlink: true,
        symlinkTarget: resolve(String(target)),
        ino: ++this.nextIno,
      });
    });
    m(fs, "linkSync", (existing: fs.PathLike, p: fs.PathLike) => {
      const node = this.vfs.get(String(existing));
      this.vfs.set(String(p), {
        isDir: false,
        content: node?.content,
        nlink: 2,
        ino: node?.ino ?? ++this.nextIno,
      });
      if (node) node.nlink = 2;
    });
  }

  cleanup(): void {
    for (const s of this.spies.splice(0)) s.mockRestore();
    this.vfs.clear();
    this.openedFds.clear();
    this.nextIno = 1000;
    this.nextFd = 100;
  }
}
