import { spyOn } from "bun:test";
import * as fs from "node:fs";
import * as platform from "../../../olt/scripts/src/platform/index.ts";

export interface VirtualFileEntry {
  path: string;
  content: Buffer;
  isDir: boolean;
  dev: number;
  ino: number;
  nlink: number;
}

export interface VirtualDescriptorEntry {
  fd: number;
  path: string;
  isDir: boolean;
}

export class MemoryFSState {
  readonly files = new Map<string, VirtualFileEntry>();
  readonly descriptors = new Map<number, VirtualDescriptorEntry>();
  private nextFdValue = 100;
  private nextInoValue = 1000;

  onFstat?: (
    fd: number,
    desc: VirtualDescriptorEntry,
    file: VirtualFileEntry,
  ) => Partial<fs.Stats> | undefined;
  onLstat?: (path: string, file: VirtualFileEntry | undefined) => Partial<fs.Stats> | undefined;
  onOpen?: (path: string, flags: number | string) => void;
  throwOnClose = false;

  reset(): void {
    this.files.clear();
    this.descriptors.clear();
    this.nextFdValue = 100;
    this.nextInoValue = 1000;
    this.onFstat = undefined;
    this.onLstat = undefined;
    this.onOpen = undefined;
    this.throwOnClose = false;
  }

  addDir(p: string, dev = 1, ino?: number): VirtualFileEntry {
    const norm = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
    const entry: VirtualFileEntry = {
      path: norm,
      content: Buffer.alloc(0),
      isDir: true,
      dev,
      ino: ino ?? ++this.nextInoValue,
      nlink: 1,
    };
    this.files.set(norm, entry);
    return entry;
  }

  addFile(p: string, content = "", dev = 1, ino?: number, nlink = 1): VirtualFileEntry {
    const entry: VirtualFileEntry = {
      path: p,
      content: Buffer.from(content, "utf8"),
      isDir: false,
      dev,
      ino: ino ?? ++this.nextInoValue,
      nlink,
    };
    this.files.set(p, entry);
    return entry;
  }

  allocFd(path: string, isDir: boolean): number {
    const fd = ++this.nextFdValue;
    this.descriptors.set(fd, { fd, path, isDir });
    return fd;
  }
}

export function installMemoryFSSpies(mem: MemoryFSState): {
  spies: Array<{ mockRestore: () => void }>;
  cleanup: () => void;
} {
  const spies: Array<{ mockRestore: () => void }> = [
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return mem.files.has(s);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      mem.addDir(s);
      return s;
    }),
    spyOn(fs, "realpathSync").mockImplementation((p: fs.PathLike) => String(p)),
    spyOn(fs, "openSync").mockImplementation((p: fs.PathLike, flags: number | string) => {
      const s = String(p);
      mem.onOpen?.(s, flags);
      let file = mem.files.get(s);
      if (!file) {
        const flagNum = typeof flags === "number" ? flags : 0;
        if (
          flagNum & fs.constants.O_CREAT ||
          String(flags).includes("w") ||
          String(flags).includes("a")
        ) {
          file = mem.addFile(s, "");
        } else {
          throw Object.assign(new Error(`ENOENT: no such file or directory, open '${s}'`), {
            code: "ENOENT",
          });
        }
      }
      return mem.allocFd(s, file.isDir);
    }),
    spyOn(fs, "closeSync").mockImplementation((fd: number) => {
      if (mem.throwOnClose) {
        throw new Error("Simulated closeSync failure");
      }
      mem.descriptors.delete(fd);
    }),
    spyOn(fs, "fstatSync").mockImplementation((fd: number) => {
      const desc = mem.descriptors.get(fd);
      if (!desc) throw Object.assign(new Error("EBADF: bad file descriptor"), { code: "EBADF" });
      const file = mem.files.get(desc.path);
      if (!file) throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      const overrides = mem.onFstat?.(fd, desc, file) ?? {};
      return {
        isFile: overrides.isFile ? overrides.isFile : () => !file.isDir,
        isDirectory: overrides.isDirectory ? overrides.isDirectory : () => file.isDir,
        dev: overrides.dev ?? file.dev,
        ino: overrides.ino ?? file.ino,
        nlink: overrides.nlink ?? file.nlink,
      } as unknown as fs.Stats;
    }),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      const file = mem.files.get(s);
      const overrides = mem.onLstat?.(s, file) ?? {};
      if (!file)
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${s}'`), {
          code: "ENOENT",
        });
      return {
        isFile: overrides.isFile ? overrides.isFile : () => !file.isDir,
        isDirectory: overrides.isDirectory ? overrides.isDirectory : () => file.isDir,
        dev: overrides.dev ?? file.dev,
        ino: overrides.ino ?? file.ino,
        nlink: overrides.nlink ?? file.nlink,
      } as unknown as fs.Stats;
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      const file = mem.files.get(s);
      if (!file)
        throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${s}'`), {
          code: "ENOENT",
        });
      return {
        isFile: () => !file.isDir,
        isDirectory: () => file.isDir,
        dev: file.dev,
        ino: file.ino,
        nlink: file.nlink,
      } as unknown as fs.Stats;
    }),
    spyOn(fs, "writeSync").mockImplementation(
      (
        fd: number,
        buffer: NodeJS.ArrayBufferView | string,
        offset?: number | null,
        length?: number | null,
      ) => {
        const desc = mem.descriptors.get(fd);
        if (!desc) throw Object.assign(new Error("EBADF: bad file descriptor"), { code: "EBADF" });
        const file = mem.files.get(desc.path);
        if (!file) throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
        const chunk =
          typeof buffer === "string"
            ? Buffer.from(buffer, "utf8")
            : Buffer.from(
                buffer.buffer,
                buffer.byteOffset + (offset ?? 0),
                length ?? buffer.byteLength,
              );
        file.content = Buffer.concat([file.content, chunk]);
        return chunk.length;
      },
    ),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
    spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      let file: VirtualFileEntry | undefined;
      if (typeof p === "number") {
        const desc = mem.descriptors.get(p);
        if (desc) file = mem.files.get(desc.path);
      } else {
        file = mem.files.get(String(p));
      }
      if (!file) throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      return file.content.toString("utf8");
    }),
    spyOn(fs, "renameSync").mockImplementation((src: fs.PathLike, dst: fs.PathLike) => {
      const s = String(src);
      const d = String(dst);
      const file = mem.files.get(s);
      if (!file)
        throw Object.assign(new Error(`ENOENT: rename '${s}' -> '${d}'`), { code: "ENOENT" });
      mem.files.delete(s);
      file.path = d;
      mem.files.set(d, file);
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      if (!mem.files.has(s))
        throw Object.assign(new Error(`ENOENT: unlink '${s}'`), { code: "ENOENT" });
      mem.files.delete(s);
    }),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true),
    spyOn(platform, "releaseFlock").mockImplementation(() => {}),
  ];

  function cleanup(): void {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    mem.reset();
  }

  return { spies, cleanup };
}
