import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CaptureRecord } from "../../../../olt/scripts/src/engine/store/capsule/captures.ts";

const vfs = new Map<string, Buffer>();
const openFds = new Map<number, { path: string; content: Buffer }>();
let nextFd = 100;
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => resolve(String(p)).replace(/\/+$/, "");

export function setupAssetVirtualFS(): void {
  cleanupAssetVirtualFS();
  const oe = fs.existsSync.bind(fs);
  const or = fs.readFileSync.bind(fs);
  const ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs);
  const orm = fs.rmSync.bind(fs);
  const orp = fs.realpathSync.bind(fs);
  const ol = fs.lstatSync.bind(fs);
  const oo = fs.openSync.bind(fs);
  const orsync = fs.readSync.bind(fs);
  const oc = fs.closeSync.bind(fs);
  const owsync = fs.writeSync.bind(fs);
  const ofs = fs.fsyncSync.bind(fs);
  const orn = fs.renameSync.bind(fs);
  const och = fs.chmodSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/")
        ? vfs.has(norm(p)) || Array.from(vfs.keys()).some((k) => k.startsWith(`${norm(p)}/`))
        : oe(p),
    ),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c.toString("utf-8")
          : c;
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          Buffer.isBuffer(d)
            ? d
            : typeof d === "string"
              ? Buffer.from(d, "utf-8")
              : Buffer.from(d.buffer, d.byteOffset, d.byteLength),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? undefined : (om(p) as string | undefined),
    ),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? norm(p) : orp(p),
    ),
    spyOn(fs, "lstatSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isF = vfs.has(s);
        const isD = !isF && Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isF && !isD) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isF,
          isDirectory: () => isD,
          isSymbolicLink: () => false,
          size: isF ? vfs.get(s)!.length : 0,
        } as unknown as fs.Stats;
      }
      return ol(p);
    }),
    spyOn(fs, "openSync").mockImplementation((p, f) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        let c = vfs.get(s);
        if (!c) {
          c = Buffer.alloc(0);
          vfs.set(s, c);
        }
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content: c });
        return fd;
      }
      return oo(p, f);
    }),
    spyOn(fs, "readSync").mockImplementation((fd, buf, off = 0, len = buf.byteLength, pos = 0) => {
      const f = openFds.get(fd);
      if (f) {
        const p = typeof pos === "number" ? pos : 0;
        const slice = f.content.subarray(p, p + len);
        slice.copy(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), off);
        return slice.length;
      }
      return orsync(fd, buf, off, len, pos);
    }),
    spyOn(fs, "writeSync").mockImplementation((fd, buf, off, len, pos) => {
      const f = openFds.get(fd);
      if (f) {
        const b =
          typeof buf === "string"
            ? Buffer.from(buf, "utf-8")
            : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
        const chunk = b.subarray(off ?? 0, (off ?? 0) + (len ?? b.length));
        f.content = Buffer.concat([f.content, chunk]);
        vfs.set(f.path, f.content);
        return chunk.length;
      }
      return owsync(fd, buf as NodeJS.ArrayBufferView, off, len, pos);
    }),
    spyOn(fs, "fsyncSync").mockImplementation((fd) => (openFds.has(fd) ? undefined : ofs(fd))),
    spyOn(fs, "renameSync").mockImplementation((o, np) => {
      const so = norm(o);
      const sn = norm(np);
      if (so.startsWith("/virtual/") || sn.startsWith("/virtual/")) {
        const c = vfs.get(so);
        if (c) {
          vfs.delete(so);
          vfs.set(sn, c);
        }
        return;
      }
      orn(o, np);
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) =>
      norm(p).startsWith("/virtual/") ? undefined : och(p, m),
    ),
    spyOn(fs, "closeSync").mockImplementation((fd) =>
      openFds.has(fd) ? (openFds.delete(fd), undefined) : oc(fd),
    ),
  );
}

export function cleanupAssetVirtualFS(): void {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
}

export function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/graph-asset-completeness-${rootCounter}`;
  vfs.set(`${root}/evidence`, Buffer.alloc(0));
  return root;
}

export function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n\n", 1, "latin1");
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(48)]);
}

export function writePng(
  root: string,
  relativePath: string,
  width: number,
  height: number,
): number {
  const bytes = png(width, height);
  writeFileSync(join(root, relativePath), bytes);
  return bytes.length;
}

export function capture(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    kind: "screenshot",
    name: "shot.png",
    sha256: "a".repeat(64),
    bytes: 0,
    blob_path: "evidence/shot.png",
    path: "evidence/shot.png",
    storage: "copy",
    original_path: "evidence/shot.png",
    ...overrides,
  };
}
