/**
 * Type definitions, stats, dirent, and error primitives for Virtual In-Memory Filesystem.
 */

export type VirtualNodeType = "file" | "dir";

export interface VirtualStatsInit {
  size?: number | undefined;
  mode?: number | undefined;
  atimeMs?: number | undefined;
  mtimeMs?: number | undefined;
  ctimeMs?: number | undefined;
  birthtimeMs?: number | undefined;
  isDir?: boolean | undefined;
}

export class VirtualStats {
  readonly size: number;
  readonly mode: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly atime: Date;
  readonly mtime: Date;
  readonly ctime: Date;
  readonly birthtime: Date;
  private readonly _isDir: boolean;

  constructor(init: VirtualStatsInit = {}) {
    const now = Date.now();
    this.size = init.size ?? 0;
    this.mode = init.mode ?? (init.isDir ? 0o755 : 0o644);
    this.atimeMs = init.atimeMs ?? now;
    this.mtimeMs = init.mtimeMs ?? now;
    this.ctimeMs = init.ctimeMs ?? now;
    this.birthtimeMs = init.birthtimeMs ?? now;
    this.atime = new Date(this.atimeMs);
    this.mtime = new Date(this.mtimeMs);
    this.ctime = new Date(this.ctimeMs);
    this.birthtime = new Date(this.birthtimeMs);
    this._isDir = Boolean(init.isDir);
  }

  isFile(): boolean {
    return !this._isDir;
  }
  isDirectory(): boolean {
    return this._isDir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }

  clone(updates?: Partial<VirtualStatsInit>): VirtualStats {
    return new VirtualStats({
      size: updates?.size ?? this.size,
      mode: updates?.mode ?? this.mode,
      atimeMs: updates?.atimeMs ?? this.atimeMs,
      mtimeMs: updates?.mtimeMs ?? this.mtimeMs,
      ctimeMs: updates?.ctimeMs ?? this.ctimeMs,
      birthtimeMs: updates?.birthtimeMs ?? this.birthtimeMs,
      isDir: updates?.isDir ?? this._isDir,
    });
  }
}

export class VirtualDirent {
  readonly name: string;
  readonly parentPath: string;
  private readonly _isDir: boolean;

  constructor(name: string, type: VirtualNodeType, parentPath: string) {
    this.name = name;
    this.parentPath = parentPath;
    this._isDir = type === "dir";
  }

  isFile(): boolean {
    return !this._isDir;
  }
  isDirectory(): boolean {
    return this._isDir;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

export interface VirtualFileNode {
  readonly type: "file";
  readonly name: string;
  readonly path: string;
  data: Uint8Array;
  stats: VirtualStats;
}

export interface VirtualDirNode {
  readonly type: "dir";
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, VirtualFSNode>;
  stats: VirtualStats;
}

export type VirtualFSNode = VirtualFileNode | VirtualDirNode;

export type WriteFileOptions =
  | {
      encoding?: BufferEncoding | null | undefined;
      flag?: string | undefined;
      mode?: number | undefined;
    }
  | BufferEncoding
  | null
  | undefined;

export type ReadFileOptions =
  | { encoding?: BufferEncoding | null | undefined; flag?: string | undefined }
  | BufferEncoding
  | null
  | undefined;

export type MkdirOptions =
  | { recursive?: boolean | undefined; mode?: number | undefined }
  | boolean
  | undefined;

export type RmOptions =
  | {
      recursive?: boolean | undefined;
      force?: boolean | undefined;
      maxRetries?: number | undefined;
      retryDelay?: number | undefined;
    }
  | undefined;

export type ReaddirOptions =
  | {
      withFileTypes?: boolean | undefined;
      recursive?: boolean | undefined;
      encoding?: BufferEncoding | string | undefined;
    }
  | BufferEncoding
  | string
  | undefined;

export type StatOptions =
  | { throwIfNoEntry?: boolean | undefined; bigint?: boolean | undefined }
  | undefined;

export class VirtualFSError extends Error {
  readonly code: string;
  readonly path?: string | undefined;
  readonly syscall?: string | undefined;

  constructor(code: string, message: string, path?: string, syscall?: string) {
    super(message);
    this.name = "VirtualFSError";
    this.code = code;
    this.path = path;
    this.syscall = syscall;
    Object.setPrototypeOf(this, VirtualFSError.prototype);
  }

  static enoent(path: string, syscall = "open"): VirtualFSError {
    return new VirtualFSError(
      "ENOENT",
      `ENOENT: no such file or directory, ${syscall} '${path}'`,
      path,
      syscall,
    );
  }

  static eisdir(path: string, syscall = "read"): VirtualFSError {
    return new VirtualFSError(
      "EISDIR",
      `EISDIR: illegal operation on a directory, ${syscall} '${path}'`,
      path,
      syscall,
    );
  }

  static enotdir(path: string, syscall = "scandir"): VirtualFSError {
    return new VirtualFSError(
      "ENOTDIR",
      `ENOTDIR: not a directory, ${syscall} '${path}'`,
      path,
      syscall,
    );
  }

  static eexist(path: string, syscall = "mkdir"): VirtualFSError {
    return new VirtualFSError(
      "EEXIST",
      `EEXIST: file already exists, ${syscall} '${path}'`,
      path,
      syscall,
    );
  }

  static eperm(path: string, syscall = "unlink"): VirtualFSError {
    return new VirtualFSError(
      "EPERM",
      `EPERM: operation not permitted, ${syscall} '${path}'`,
      path,
      syscall,
    );
  }
}

export type VirtualFSSnapshot = Record<string, string | Uint8Array>;

export interface IVirtualFileSystem {
  writeFileSync(filePath: string, data: string | Uint8Array, options?: WriteFileOptions): void;
  readFileSync(
    filePath: string,
    options: BufferEncoding | { encoding: BufferEncoding; flag?: string },
  ): string;
  readFileSync(
    filePath: string,
    options?: { encoding?: null | undefined; flag?: string } | null,
  ): Uint8Array;
  readFileSync(filePath: string, options?: ReadFileOptions): string | Uint8Array;
  existsSync(targetPath: string): boolean;
  mkdirSync(dirPath: string, options?: MkdirOptions): string | undefined;
  unlinkSync(filePath: string): void;
  rmSync(targetPath: string, options?: RmOptions): void;
  readdirSync(
    dirPath: string,
    options: { withFileTypes: true; recursive?: boolean },
  ): VirtualDirent[];
  readdirSync(
    dirPath: string,
    options?: { withFileTypes?: false | undefined; recursive?: boolean } | BufferEncoding | string,
  ): string[];
  readdirSync(dirPath: string, options?: ReaddirOptions): string[] | VirtualDirent[];
  statSync(targetPath: string, options?: StatOptions): VirtualStats | undefined;
  fsyncSync(fdOrPath?: number | string): void;
  reset(): void;
  cwd(): string;
  chdir(dir: string): void;
  dumpTree(): Record<string, string>;
  loadSnapshot(snapshot: VirtualFSSnapshot): void;
}
