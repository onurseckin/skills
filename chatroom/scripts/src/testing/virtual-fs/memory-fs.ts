import { Buffer } from "node:buffer";
import { SyntheticClock } from "./clock.ts";
import {
  VirtualDirent,
  type VirtualDirNode,
  type VirtualFileNode,
  VirtualStats,
} from "./descriptors.ts";
import { VirtualFSError } from "./errors.ts";
import { SyntheticPidTable } from "./pid-table.ts";
import {
  createDirNode,
  dumpTreeSnapshot,
  lookupNode,
  normalizePosixPath,
  rebasePath,
  resolveParent,
} from "./tree.ts";
import type {
  ChatVirtualFSSnapshot,
  MkdirOptions,
  ProcessRecord,
  ProcessSpawnOptions,
  ReadFileOptions,
  ReaddirOptions,
  RmOptions,
  StatOptions,
  WatchEventType,
  WatchListener,
  WatchOptions,
  WriteFileOptions,
} from "./types.ts";
import { VirtualWatcher } from "./watcher.ts";

export { normalizePosixPath };

export class ChatVirtualFS {
  readonly clock: SyntheticClock;
  readonly pidTable: SyntheticPidTable;
  private root: VirtualDirNode;
  private currentWorkingDir = "/";
  private readonly watchers = new Set<VirtualWatcher>();

  constructor(initialClockMs?: number) {
    this.clock = new SyntheticClock(initialClockMs);
    this.pidTable = new SyntheticPidTable();
    this.root = createDirNode("", "/", this.clock.now());
  }

  cwd(): string {
    return this.currentWorkingDir;
  }

  chdir(dir: string): void {
    const target = normalizePosixPath(dir, this.currentWorkingDir);
    const resolved = lookupNode(this.root, target);
    if (!resolved.node) {
      throw VirtualFSError.enoent(target, "chdir");
    }
    if (resolved.node.type !== "dir") {
      throw VirtualFSError.enotdir(target, "chdir");
    }
    this.currentWorkingDir = target;
  }

  reset(): void {
    this.root = createDirNode("", "/", this.clock.now());
    this.currentWorkingDir = "/";
    this.clock.reset();
    this.pidTable.reset();
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }

  existsSync(targetPath: string): boolean {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    return norm === "/" || lookupNode(this.root, norm).node !== undefined;
  }

  writeFileSync(
    filePath: string,
    data: string | Uint8Array,
    options?: WriteFileOptions | BufferEncoding,
  ): void {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    if (norm === "/") {
      throw VirtualFSError.eisdir("/", "open");
    }
    const { parent, name } = resolveParent(this.root, norm, "open");
    const enc = typeof options === "string" ? options : (options?.encoding ?? "utf-8");
    const bytes = typeof data === "string" ? Buffer.from(data, enc) : data;
    const existing = parent.children.get(name);
    if (existing?.type === "dir") {
      throw VirtualFSError.eisdir(norm, "open");
    }
    const now = this.clock.now();
    const stats = new VirtualStats({
      size: bytes.byteLength,
      mode: typeof options === "object" && typeof options?.mode === "number" ? options.mode : 0o644,
      isDir: false,
      mtimeMs: now,
      ctimeMs: now,
      atimeMs: now,
      birthtimeMs: existing ? existing.stats.birthtimeMs : now,
    });
    const fileNode: VirtualFileNode = { type: "file", name, path: norm, data: bytes, stats };
    parent.children.set(name, fileNode);
    parent.stats = parent.stats.clone({ mtimeMs: now, ctimeMs: now });
    this.notifyWatchers(norm, existing ? "change" : "rename");
  }

  appendFileSync(
    filePath: string,
    data: string | Uint8Array,
    options?: WriteFileOptions | BufferEncoding,
  ): void {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    const existing = lookupNode(this.root, norm).node;
    if (!existing) {
      this.writeFileSync(norm, data, options);
      return;
    }
    if (existing.type === "dir") {
      throw VirtualFSError.eisdir(norm, "open");
    }
    const enc = typeof options === "string" ? options : (options?.encoding ?? "utf-8");
    const additional = typeof data === "string" ? Buffer.from(data, enc) : data;
    const combined = new Uint8Array(existing.data.byteLength + additional.byteLength);
    combined.set(existing.data, 0);
    combined.set(additional, existing.data.byteLength);
    existing.data = combined;
    const now = this.clock.now();
    existing.stats = existing.stats.clone({
      size: combined.byteLength,
      mtimeMs: now,
      ctimeMs: now,
    });
    this.notifyWatchers(norm, "change");
  }

  readFileSync(
    filePath: string,
    options?: BufferEncoding | ReadFileOptions | null,
  ): string | Uint8Array {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    const { node } = lookupNode(this.root, norm);
    if (!node) {
      throw VirtualFSError.enoent(norm, "open");
    }
    if (node.type === "dir") {
      throw VirtualFSError.eisdir(norm, "read");
    }
    node.stats = node.stats.clone({ atimeMs: this.clock.now() });
    const enc = typeof options === "string" ? options : options?.encoding;
    return enc ? Buffer.from(node.data).toString(enc) : new Uint8Array(node.data);
  }

  mkdirSync(dirPath: string, options?: MkdirOptions | boolean): string | undefined {
    const norm = normalizePosixPath(dirPath, this.currentWorkingDir);
    const recursive = typeof options === "boolean" ? options : Boolean(options?.recursive);
    if (norm === "/") {
      if (recursive) {
        return undefined;
      }
      throw VirtualFSError.eexist("/", "mkdir");
    }
    if (!recursive) {
      const { parent, name } = resolveParent(this.root, norm, "mkdir");
      if (parent.children.has(name)) {
        throw VirtualFSError.eexist(norm, "mkdir");
      }
      const newDir = createDirNode(name, norm, this.clock.now());
      parent.children.set(name, newDir);
      const now = this.clock.now();
      parent.stats = parent.stats.clone({ mtimeMs: now, ctimeMs: now });
      this.notifyWatchers(norm, "rename");
      return norm;
    }
    let current = this.root;
    let currPath = "";
    let firstCreated: string | undefined;
    for (const seg of norm.split("/").filter(Boolean)) {
      currPath += "/" + seg;
      const child = current.children.get(seg);
      if (!child) {
        const newDir = createDirNode(seg, currPath, this.clock.now());
        current.children.set(seg, newDir);
        const now = this.clock.now();
        current.stats = current.stats.clone({ mtimeMs: now, ctimeMs: now });
        firstCreated ??= currPath;
        current = newDir;
        this.notifyWatchers(currPath, "rename");
      } else if (child.type === "file") {
        throw VirtualFSError.enotdir(currPath, "mkdir");
      } else {
        current = child;
      }
    }
    return firstCreated;
  }

  readdirSync(
    dirPath: string,
    options?: ReaddirOptions | BufferEncoding | string,
  ): string[] | VirtualDirent[] {
    const norm = normalizePosixPath(dirPath, this.currentWorkingDir);
    const { node } = lookupNode(this.root, norm);
    if (!node) {
      throw VirtualFSError.enoent(norm, "scandir");
    }
    if (node.type !== "dir") {
      throw VirtualFSError.enotdir(norm, "scandir");
    }
    const withTypes =
      typeof options === "object" && options !== null && Boolean(options.withFileTypes);
    const recursive = typeof options === "object" && options !== null && Boolean(options.recursive);
    if (!recursive) {
      return withTypes
        ? Array.from(node.children.values(), (c) => new VirtualDirent(c.name, c.type === "dir"))
        : Array.from(node.children.keys()).sort();
    }
    const results: (string | VirtualDirent)[] = [];
    const collect = (dir: VirtualDirNode, prefix: string): void => {
      for (const k of Array.from(dir.children.keys()).sort()) {
        const child = dir.children.get(k)!;
        const rel = prefix ? `${prefix}/${k}` : k;
        results.push(withTypes ? new VirtualDirent(k, child.type === "dir") : rel);
        if (child.type === "dir") {
          collect(child, rel);
        }
      }
    };
    collect(node, "");
    return results as string[] | VirtualDirent[];
  }

  statSync(targetPath: string, options?: StatOptions): VirtualStats | undefined {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    const { node } = lookupNode(this.root, norm);
    if (!node) {
      if (options?.throwIfNoEntry === false) {
        return undefined;
      }
      throw VirtualFSError.enoent(norm, "stat");
    }
    return node.stats.clone();
  }

  renameSync(oldPath: string, newPath: string): void {
    const oldNorm = normalizePosixPath(oldPath, this.currentWorkingDir);
    const newNorm = normalizePosixPath(newPath, this.currentWorkingDir);
    if (oldNorm === "/" || newNorm === "/") {
      throw VirtualFSError.eperm("/", "rename");
    }
    const { parent: oldParent, name: oldName } = resolveParent(this.root, oldNorm, "rename");
    const node = oldParent.children.get(oldName);
    if (!node) {
      throw VirtualFSError.enoent(oldNorm, "rename");
    }
    const { parent: newParent, name: newName } = resolveParent(this.root, newNorm, "rename");
    const rebased = rebasePath(node, newName, newNorm);
    oldParent.children.delete(oldName);
    newParent.children.set(newName, rebased);
    const now = this.clock.now();
    oldParent.stats = oldParent.stats.clone({ mtimeMs: now, ctimeMs: now });
    newParent.stats = newParent.stats.clone({ mtimeMs: now, ctimeMs: now });
    this.notifyWatchers(oldNorm, "rename");
    this.notifyWatchers(newNorm, "rename");
  }

  unlinkSync(filePath: string): void {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    if (norm === "/") {
      throw VirtualFSError.eperm("/", "unlink");
    }
    const { parent, name } = resolveParent(this.root, norm, "unlink");
    const child = parent.children.get(name);
    if (!child) {
      throw VirtualFSError.enoent(norm, "unlink");
    }
    if (child.type === "dir") {
      throw VirtualFSError.eperm(norm, "unlink");
    }
    parent.children.delete(name);
    const now = this.clock.now();
    parent.stats = parent.stats.clone({ mtimeMs: now, ctimeMs: now });
    this.notifyWatchers(norm, "rename");
  }

  rmSync(targetPath: string, options?: RmOptions): void {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    if (norm === "/") {
      if (!options?.recursive) {
        throw VirtualFSError.eisdir("/", "rm");
      }
      this.reset();
      return;
    }
    const segments = norm.split("/").filter(Boolean);
    const leaf = segments[segments.length - 1]!;
    const parentPath = segments.length <= 1 ? "/" : "/" + segments.slice(0, -1).join("/");
    const { node: parent } = lookupNode(this.root, parentPath);
    if (!parent || parent.type !== "dir" || !parent.children.has(leaf)) {
      if (options?.force) {
        return;
      }
      throw VirtualFSError.enoent(norm, "rm");
    }
    const child = parent.children.get(leaf)!;
    if (child.type === "dir" && !options?.recursive) {
      throw VirtualFSError.eisdir(norm, "rm");
    }
    parent.children.delete(leaf);
    const now = this.clock.now();
    parent.stats = parent.stats.clone({ mtimeMs: now, ctimeMs: now });
    this.notifyWatchers(norm, "rename");
  }

  watch(
    targetPath: string,
    optionsOrListener?: WatchOptions | WatchListener,
    listener?: WatchListener,
  ): VirtualWatcher {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    const callback = typeof optionsOrListener === "function" ? optionsOrListener : listener;
    const opts = typeof optionsOrListener === "object" ? optionsOrListener : undefined;
    const recursive = Boolean(opts?.recursive);
    const watcher = new VirtualWatcher(norm, recursive, callback, (w) => {
      this.watchers.delete(w);
    });
    this.watchers.add(watcher);
    return watcher;
  }

  fsyncSync(_fdOrPath?: number | string): void {}

  dumpTree(): ChatVirtualFSSnapshot {
    return dumpTreeSnapshot(this.root);
  }

  loadSnapshot(snapshot: ChatVirtualFSSnapshot): void {
    for (const [filePath, content] of Object.entries(snapshot)) {
      const norm = normalizePosixPath(filePath, this.currentWorkingDir);
      const segments = norm.split("/").filter(Boolean);
      if (segments.length > 1) {
        this.mkdirSync("/" + segments.slice(0, -1).join("/"), { recursive: true });
      }
      this.writeFileSync(norm, content);
    }
  }

  now(): number {
    return this.clock.now();
  }

  iso(): string {
    return this.clock.iso();
  }

  advanceTime(ms: number): void {
    this.clock.advance(ms);
  }

  isProcessAlive(pid: number): boolean {
    return this.pidTable.isProcessAlive(pid);
  }

  registerProcess(pid: number, options?: ProcessSpawnOptions): ProcessRecord {
    return this.pidTable.registerProcess(pid, options);
  }

  spawnProcess(options?: ProcessSpawnOptions): number {
    return this.pidTable.spawnProcess(options);
  }

  killProcess(pid: number): boolean {
    return this.pidTable.killProcess(pid);
  }

  private notifyWatchers(changedPath: string, eventType: WatchEventType): void {
    for (const watcher of this.watchers) {
      if (watcher.path === changedPath) {
        const leaf = changedPath.split("/").filter(Boolean).pop() ?? "";
        watcher.emitEvent(eventType, leaf);
      } else if (changedPath.startsWith(watcher.path + "/")) {
        const rel = changedPath.slice(watcher.path.length + 1);
        const segments = rel.split("/");
        if (watcher.recursive || segments.length === 1) {
          watcher.emitEvent(eventType, segments[0] ?? null);
        }
      }
    }
  }
}
