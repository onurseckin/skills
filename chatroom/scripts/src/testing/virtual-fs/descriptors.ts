import type { ChatFSDirent, ChatFSStats, VirtualStatsOptions } from "./types.ts";

export class VirtualStats implements ChatFSStats {
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly atimeMs: number;
  readonly birthtimeMs: number;
  private readonly isDir: boolean;

  constructor(options?: VirtualStatsOptions) {
    const now = Date.now();
    this.isDir = options?.isDir ?? false;
    this.size = options?.size ?? 0;
    this.mode = options?.mode ?? (this.isDir ? 0o755 : 0o644);
    this.mtimeMs = options?.mtimeMs ?? now;
    this.ctimeMs = options?.ctimeMs ?? now;
    this.atimeMs = options?.atimeMs ?? now;
    this.birthtimeMs = options?.birthtimeMs ?? now;
  }

  isDirectory(): boolean {
    return this.isDir;
  }

  isFile(): boolean {
    return !this.isDir;
  }

  clone(updates?: Partial<VirtualStatsOptions>): VirtualStats {
    return new VirtualStats({
      isDir: updates?.isDir ?? this.isDir,
      size: updates?.size ?? this.size,
      mode: updates?.mode ?? this.mode,
      mtimeMs: updates?.mtimeMs ?? this.mtimeMs,
      ctimeMs: updates?.ctimeMs ?? this.ctimeMs,
      atimeMs: updates?.atimeMs ?? this.atimeMs,
      birthtimeMs: updates?.birthtimeMs ?? this.birthtimeMs,
    });
  }
}

export class VirtualDirent implements ChatFSDirent {
  readonly name: string;
  private readonly isDir: boolean;

  constructor(name: string, isDir: boolean) {
    this.name = name;
    this.isDir = isDir;
  }

  isDirectory(): boolean {
    return this.isDir;
  }

  isFile(): boolean {
    return !this.isDir;
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
