import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  measureAssets,
  measureCapsuleAsset,
  readHeader,
} from "../../../olt/scripts/src/summary/assets/index.ts";
import type { MediaAsset } from "../../../olt/scripts/src/summary/graph/index.ts";

interface VirtualNode {
  content?: Buffer;
  isDir: boolean;
  symlinkTarget?: string;
  mode?: number;
}

const vfs = new Map<string, VirtualNode>();
const openFds = new Map<number, { path: string; node: VirtualNode }>();
let nextFd = 100,
  rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const norm = (p: string): string => resolve(p).replace(/\/+$/, "") || "/";

function resolvePath(p: string, seen = new Set<string>()): string {
  const normalized = norm(p);
  if (seen.has(normalized)) return normalized;
  seen.add(normalized);
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (let i = 0; i < parts.length; i++) {
    const next = `${current}/${parts[i]}`;
    const pnode = vfs.get(next);
    if (pnode?.symlinkTarget)
      return resolvePath(resolve(pnode.symlinkTarget, parts.slice(i + 1).join("/")), seen);
    current = next;
  }
  return normalized;
}

function getVirtualNode(p: string): { path: string; node: VirtualNode } | undefined {
  const n = norm(p);
  const node = vfs.get(n);
  if (node) return { path: n, node };
  for (const k of vfs.keys()) {
    if (k.startsWith(`${n}/`)) return { path: n, node: { isDir: true } };
  }
  return undefined;
}

beforeEach(() => {
  spies.push(
    spyOn(fs, "realpathSync").mockImplementation((p: fs.PathLike): string => {
      const s = String(p),
        target = resolvePath(s);
      if (!getVirtualNode(target) && !s.startsWith("/virtual/"))
        throw new Error(`ENOENT: realpath '${s}'`);
      return target;
    }),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const entry = getVirtualNode(resolve(String(p)));
      if (!entry) throw new Error(`ENOENT: lstat '${p}'`);
      const node = entry.node,
        isSymlink = Boolean(node.symlinkTarget);
      return {
        isFile: () => !node.isDir && !isSymlink,
        isDirectory: () => node.isDir,
        isSymbolicLink: () => isSymlink,
        size: node.content ? node.content.length : 0,
        mode: node.mode ?? (node.isDir ? 0o755 : 0o644),
      } as unknown as fs.Stats;
    }),
    spyOn(fs, "openSync").mockImplementation((p: fs.PathLike): number => {
      const s = String(p),
        entry = getVirtualNode(resolvePath(s));
      if (!entry || entry.node.isDir) throw new Error(`ENOENT: open '${s}'`);
      if (entry.node.mode === 0o000) throw new Error(`EACCES: open '${s}'`);
      const fd = ++nextFd;
      openFds.set(fd, entry);
      return fd;
    }),
    spyOn(fs, "readSync").mockImplementation(
      (fd, buffer, offset = 0, length = buffer.byteLength, position = 0): number => {
        const openFile = openFds.get(fd);
        if (!openFile) throw new Error("EBADF: bad file descriptor");
        const content = openFile.node.content ?? Buffer.alloc(0);
        const pos = typeof position === "number" ? position : 0;
        const slice = content.subarray(pos, pos + length);
        slice.copy(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength), offset);
        return slice.length;
      },
    ),
    spyOn(fs, "closeSync").mockImplementation((fd: number) => {
      openFds.delete(fd);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      const s = norm(String(p));
      const buf = Buffer.isBuffer(data)
        ? data
        : typeof data === "string"
          ? Buffer.from(data, "utf-8")
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      vfs.set(s, { content: buf, isDir: false });
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(norm(String(p)), { isDir: true });
      return undefined;
    }),
    spyOn(fs, "symlinkSync").mockImplementation((target, p) => {
      vfs.set(norm(String(p)), { isDir: false, symlinkTarget: norm(String(target)) });
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, mode) => {
      const node = vfs.get(norm(String(p)));
      if (node) node.mode = typeof mode === "number" ? mode : Number.parseInt(String(mode), 8);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
});

function runRoot(): string {
  rootCounter += 1;
  const root = `/virtual/asset-measure-${rootCounter}`;
  vfs.set(root, { isDir: true });
  vfs.set(`${root}/evidence`, { isDir: true });
  return root;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(0x89, 0);
  header.write("PNG\r\n \n", 1, "latin1");
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(40)]);
}

function gif(width: number, height: number): Buffer {
  const header = Buffer.alloc(16);
  header.write("GIF89a", 0, "latin1");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return header;
}

function bmp(width: number, height: number): Buffer {
  const header = Buffer.alloc(30);
  header.write("BM", 0, "latin1");
  header.writeInt32LE(width, 18);
  header.writeInt32LE(-height, 22);
  return header;
}

function asset(url: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return { id: `asset-${url}`, type: "image", url, ...overrides };
}

describe("measuring an asset the capsule still holds", () => {
  test("reads the byte size and the pixel size out of a PNG header", () => {
    const root = runRoot();
    const bytes = png(1440, 900);
    fs.writeFileSync(join(root, "evidence", "shot.png"), bytes);

    expect(measureCapsuleAsset(root, "evidence/shot.png")).toEqual({
      sizeBytes: bytes.length,
      dimensions: { width: 1440, height: 900 },
    });
  });

  test("reads a GIF and a top-down BMP, whose headers state their size differently", () => {
    const root = runRoot();
    fs.writeFileSync(join(root, "evidence", "loop.gif"), gif(320, 240));
    fs.writeFileSync(join(root, "evidence", "raster.bmp"), bmp(64, 48));

    expect(measureCapsuleAsset(root, "evidence/loop.gif")?.dimensions).toEqual({
      width: 320,
      height: 240,
    });
    expect(measureCapsuleAsset(root, "evidence/raster.bmp")?.dimensions).toEqual({
      width: 64,
      height: 48,
    });
  });

  test("reports the size but no dimensions for a format it cannot read", () => {
    const root = runRoot();
    fs.writeFileSync(join(root, "evidence", "trace.zip"), Buffer.alloc(12, 7));

    const measured = measureCapsuleAsset(root, "evidence/trace.zip");
    expect(measured?.sizeBytes).toBe(12);
    expect(measured?.dimensions).toBeUndefined();
  });

  test("measures nothing it cannot open", () => {
    const root = runRoot();
    expect(measureCapsuleAsset(root, "evidence/absent.png")).toBeUndefined();
    expect(measureCapsuleAsset(undefined, "evidence/absent.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, "")).toBeUndefined();
    expect(measureCapsuleAsset("/nonexistent-capsule-root", "evidence/x.png")).toBeUndefined();
  });

  test("refuses to follow a url out of the capsule, however it is written", () => {
    const root = runRoot();
    rootCounter += 1;
    const outside = `/virtual/asset-outside-${rootCounter}`;
    fs.writeFileSync(join(outside, "secret.png"), png(10, 10));
    fs.symlinkSync(join(outside, "secret.png"), join(root, "evidence", "linked.png"));

    expect(measureCapsuleAsset(root, "../../secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, join(outside, "secret.png"))).toBeUndefined();
    expect(measureCapsuleAsset(root, "https://example.invalid/secret.png")).toBeUndefined();
    expect(measureCapsuleAsset(root, "evidence/linked.png")).toBeUndefined();
  });

  test("refuses a path whose parent directory is itself a link out of the capsule", () => {
    const root = runRoot();
    rootCounter += 1;
    const outside = `/virtual/asset-outside-dir-${rootCounter}`;
    fs.writeFileSync(join(outside, "secret.png"), png(10, 10));
    fs.symlinkSync(outside, join(root, "evidence", "elsewhere"));

    expect(measureCapsuleAsset(root, "evidence/elsewhere/secret.png")).toBeUndefined();
  });

  test("refuses a directory, which is not an asset", () => {
    const root = runRoot();
    expect(measureCapsuleAsset(root, "evidence")).toBeUndefined();
  });

  test("reports nothing when the file passes containment checks but cannot be opened", () => {
    const root = runRoot();
    const target = join(root, "evidence", "locked.png");
    fs.writeFileSync(target, png(4, 4));
    fs.chmodSync(target, 0o000);

    try {
      expect(readHeader(target)).toBeUndefined();
    } finally {
      fs.chmodSync(target, 0o644);
    }
  });
});

describe("filling in what nobody measured", () => {
  test("fills the gaps and leaves every recorded value alone", () => {
    const root = runRoot();
    const bytes = png(800, 600);
    fs.writeFileSync(join(root, "evidence", "shot.png"), bytes);

    const [measured, reported, absent] = measureAssets(
      [
        asset("evidence/shot.png"),
        asset("evidence/shot.png", {
          id: "reported",
          sizeBytes: 11,
          dimensions: { width: 1, height: 2 },
        }),
        asset("evidence/gone.png"),
      ],
      root,
    );

    expect(measured?.sizeBytes).toBe(bytes.length);
    expect(measured?.dimensions).toEqual({ width: 800, height: 600 });
    expect(reported?.sizeBytes).toBe(11);
    expect(reported?.dimensions).toEqual({ width: 1, height: 2 });
    expect(absent?.sizeBytes).toBeUndefined();
    expect(absent?.dimensions).toBeUndefined();
  });

  test("keeps the size a source reported while adding the pixels it did not", () => {
    const root = runRoot();
    fs.writeFileSync(join(root, "evidence", "shot.png"), png(120, 90));

    const [only] = measureAssets([asset("evidence/shot.png", { sizeBytes: 4 })], root);
    expect(only?.sizeBytes).toBe(4);
    expect(only?.dimensions).toEqual({ width: 120, height: 90 });
  });

  test("does nothing at all without a capsule to measure against", () => {
    const assets = [asset("evidence/shot.png")];
    expect(measureAssets(assets, undefined)).toBe(assets);
    expect(assets[0]?.sizeBytes).toBeUndefined();
  });
});
