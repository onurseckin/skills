export interface ChatFSStats {
  readonly size: number;
  readonly mode: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly atimeMs: number;
  readonly birthtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface ChatFSDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface VirtualStatsOptions {
  readonly size?: number | undefined;
  readonly mode?: number | undefined;
  readonly isDir?: boolean | undefined;
  readonly mtimeMs?: number | undefined;
  readonly ctimeMs?: number | undefined;
  readonly atimeMs?: number | undefined;
  readonly birthtimeMs?: number | undefined;
}

export interface ProcessRecord {
  readonly pid: number;
  readonly alive: boolean;
  readonly startTime: number;
  readonly bootId?: string | undefined;
  readonly cmd?: string | undefined;
}

export interface ProcessSpawnOptions {
  readonly alive?: boolean | undefined;
  readonly startTime?: number | undefined;
  readonly bootId?: string | undefined;
  readonly cmd?: string | undefined;
}

export type WatchEventType = "rename" | "change";

export type WatchListener = (eventType: WatchEventType, filename: string | null) => void;

export interface WatchOptions {
  readonly persistent?: boolean | undefined;
  readonly recursive?: boolean | undefined;
  readonly encoding?: BufferEncoding | undefined;
}

export interface IVirtualFSWatcher {
  close(): void;
  ref(): this;
  unref(): this;
}

export type ChatVirtualFSSnapshot = Record<string, string>;

export interface MkdirOptions {
  readonly recursive?: boolean | undefined;
  readonly mode?: number | undefined;
}

export interface ReadFileOptions {
  readonly encoding?: BufferEncoding | null | undefined;
  readonly flag?: string | undefined;
}

export interface WriteFileOptions {
  readonly encoding?: BufferEncoding | undefined;
  readonly mode?: number | undefined;
  readonly flag?: string | undefined;
}

export interface RmOptions {
  readonly recursive?: boolean | undefined;
  readonly force?: boolean | undefined;
}

export interface ReaddirOptions {
  readonly withFileTypes?: boolean | undefined;
  readonly recursive?: boolean | undefined;
}

export interface StatOptions {
  readonly throwIfNoEntry?: boolean | undefined;
}
