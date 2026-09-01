import * as fs from "node:fs";
import { mockSyncHandlers } from "./vfs-spies.ts";

export interface VirtualNode {
  isDir: boolean;
  content?: string;
  mode?: number;
  ino: number;
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
