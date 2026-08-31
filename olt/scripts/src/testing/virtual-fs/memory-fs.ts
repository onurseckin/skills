/**
 * In-Memory Virtual POSIX Filesystem Core Engine.
 * Provides high-speed, zero-disk file operations and sandbox isolation for testing.
 */

import {
  type IVirtualFileSystem,
  type MkdirOptions,
  type ReadFileOptions,
  type ReaddirOptions,
  type RmOptions,
  type StatOptions,
  VirtualDirent,
  type VirtualDirNode,
  VirtualFSError,
  type VirtualFSNode,
  type VirtualFSSnapshot,
  VirtualStats,
  type WriteFileOptions,
} from "./types.ts";

export function normalizePosixPath(inputPath: string, cwd = "/"): string {
  const norm = inputPath.replace(/\\/g, "/");
  const combined = norm.startsWith("/") ? norm : `${cwd}/${norm}`;
  const resolved: string[] = [];
  for (const seg of combined.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") resolved.pop();
    else resolved.push(seg);
  }
  return "/" + resolved.join("/");
}

export class VirtualMemoryFS implements IVirtualFileSystem {
  private root: VirtualDirNode;
  private currentWorkingDir = "/";

  constructor() {
    this.root = this.createDirNode("", "/");
  }

  cwd(): string {
    return this.currentWorkingDir;
  }

  chdir(dir: string): void {
    const target = normalizePosixPath(dir, this.currentWorkingDir);
    const resolved = this.lookupNode(target);
    if (!resolved.node) throw VirtualFSError.enoent(target, "chdir");
    if (resolved.node.type !== "dir") throw VirtualFSError.enotdir(target, "chdir");
    this.currentWorkingDir = target;
  }

  reset(): void {
    this.root = this.createDirNode("", "/");
    this.currentWorkingDir = "/";
  }

  existsSync(targetPath: string): boolean {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    return norm === "/" || this.lookupNode(norm).node !== undefined;
  }

  writeFileSync(filePath: string, data: string | Uint8Array, options?: WriteFileOptions): void {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    if (norm === "/") throw VirtualFSError.eisdir("/", "open");
    const { parent, name } = this.resolveParent(norm, "open");
    const enc = typeof options === "string" ? options : (options?.encoding ?? "utf-8");
    const bytes = typeof data === "string" ? Buffer.from(data, enc as BufferEncoding) : data;
    const existing = parent.children.get(name);
    if (existing?.type === "dir") throw VirtualFSError.eisdir(norm, "open");
    const now = Date.now();
    const stats = new VirtualStats({
      size: bytes.byteLength,
      isDir: false,
      mtimeMs: now,
      ctimeMs: now,
    });
    parent.children.set(name, { type: "file", name, path: norm, data: bytes, stats });
    parent.stats = parent.stats.clone({ mtimeMs: now, ctimeMs: now });
  }

  readFileSync(
    filePath: string,
    options: BufferEncoding | { encoding: BufferEncoding; flag?: string },
  ): string;
  readFileSync(
    filePath: string,
    options?: { encoding?: null | undefined; flag?: string } | null,
  ): Uint8Array;
  readFileSync(filePath: string, options?: ReadFileOptions): string | Uint8Array;
  readFileSync(filePath: string, options?: ReadFileOptions): string | Uint8Array {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    const { node } = this.lookupNode(norm);
    if (!node) throw VirtualFSError.enoent(norm, "open");
    if (node.type === "dir") throw VirtualFSError.eisdir(norm, "read");
    node.stats = node.stats.clone({ atimeMs: Date.now() });
    const enc = typeof options === "string" ? options : options?.encoding;
    return enc ? Buffer.from(node.data).toString(enc as BufferEncoding) : new Uint8Array(node.data);
  }

  mkdirSync(dirPath: string, options?: MkdirOptions): string | undefined {
    const norm = normalizePosixPath(dirPath, this.currentWorkingDir);
    const recursive = typeof options === "boolean" ? options : Boolean(options?.recursive);
    if (norm === "/") {
      if (recursive) return undefined;
      throw VirtualFSError.eexist("/", "mkdir");
    }
    if (!recursive) {
      const { parent, name } = this.resolveParent(norm, "mkdir");
      if (parent.children.has(name)) throw VirtualFSError.eexist(norm, "mkdir");
      parent.children.set(name, this.createDirNode(name, norm));
      parent.stats = parent.stats.clone({ mtimeMs: Date.now(), ctimeMs: Date.now() });
      return norm;
    }
    let current = this.root;
    let currPath = "";
    let firstCreated: string | undefined;
    for (const seg of norm.split("/").filter(Boolean)) {
      currPath += "/" + seg;
      let child = current.children.get(seg);
      if (!child) {
        const newDir = this.createDirNode(seg, currPath);
        current.children.set(seg, newDir);
        current.stats = current.stats.clone({ mtimeMs: Date.now(), ctimeMs: Date.now() });
        firstCreated ??= currPath;
        current = newDir;
      } else if (child.type === "file") {
        throw VirtualFSError.enotdir(currPath, "mkdir");
      } else {
        current = child;
      }
    }
    return firstCreated;
  }

  unlinkSync(filePath: string): void {
    const norm = normalizePosixPath(filePath, this.currentWorkingDir);
    if (norm === "/") throw VirtualFSError.eperm("/", "unlink");
    const { parent, name } = this.resolveParent(norm, "unlink");
    const child = parent.children.get(name);
    if (!child) throw VirtualFSError.enoent(norm, "unlink");
    if (child.type === "dir") throw VirtualFSError.eperm(norm, "unlink");
    parent.children.delete(name);
    parent.stats = parent.stats.clone({ mtimeMs: Date.now(), ctimeMs: Date.now() });
  }

  rmSync(targetPath: string, options?: RmOptions): void {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    if (norm === "/") {
      if (!options?.recursive) throw VirtualFSError.eisdir("/", "rm");
      this.reset();
      return;
    }
    const segments = norm.split("/").filter(Boolean);
    const leaf = segments[segments.length - 1]!;
    const parentPath = segments.length <= 1 ? "/" : "/" + segments.slice(0, -1).join("/");
    const { node: parent } = this.lookupNode(parentPath);
    if (!parent || parent.type !== "dir" || !parent.children.has(leaf)) {
      if (options?.force) return;
      throw VirtualFSError.enoent(norm, "rm");
    }
    const child = parent.children.get(leaf)!;
    if (child.type === "dir" && !options?.recursive) throw VirtualFSError.eisdir(norm, "rm");
    parent.children.delete(leaf);
    parent.stats = parent.stats.clone({ mtimeMs: Date.now(), ctimeMs: Date.now() });
  }

  readdirSync(
    dirPath: string,
    options: { withFileTypes: true; recursive?: boolean },
  ): VirtualDirent[];
  readdirSync(
    dirPath: string,
    options?: { withFileTypes?: false | undefined; recursive?: boolean } | BufferEncoding | string,
  ): string[];
  readdirSync(dirPath: string, options?: ReaddirOptions): string[] | VirtualDirent[];
  readdirSync(dirPath: string, options?: ReaddirOptions): string[] | VirtualDirent[] {
    const norm = normalizePosixPath(dirPath, this.currentWorkingDir);
    const { node } = this.lookupNode(norm);
    if (!node) throw VirtualFSError.enoent(norm, "scandir");
    if (node.type !== "dir") throw VirtualFSError.enotdir(norm, "scandir");
    const withTypes =
      typeof options === "object" && options !== null && Boolean(options.withFileTypes);
    const recursive = typeof options === "object" && options !== null && Boolean(options.recursive);
    if (!recursive) {
      return withTypes
        ? Array.from(node.children.values(), (c) => new VirtualDirent(c.name, c.type, node.path))
        : Array.from(node.children.keys()).sort();
    }
    const results: (string | VirtualDirent)[] = [];
    const collect = (dir: VirtualDirNode, prefix: string): void => {
      for (const k of Array.from(dir.children.keys()).sort()) {
        const child = dir.children.get(k)!;
        const rel = prefix ? `${prefix}/${k}` : k;
        results.push(withTypes ? new VirtualDirent(k, child.type, dir.path) : rel);
        if (child.type === "dir") collect(child, rel);
      }
    };
    collect(node, "");
    return results as string[] | VirtualDirent[];
  }

  statSync(targetPath: string, options?: StatOptions): VirtualStats | undefined {
    const norm = normalizePosixPath(targetPath, this.currentWorkingDir);
    const { node } = this.lookupNode(norm);
    if (!node) {
      if (options?.throwIfNoEntry === false) return undefined;
      throw VirtualFSError.enoent(norm, "stat");
    }
    return node.stats.clone();
  }

  fsyncSync(_fdOrPath?: number | string): void {
    // Instant POSIX NO-OP in virtual memory
  }

  dumpTree(): Record<string, string> {
    const result: Record<string, string> = {};
    const traverse = (dir: VirtualDirNode): void => {
      for (const child of dir.children.values()) {
        if (child.type === "file") result[child.path] = Buffer.from(child.data).toString("utf-8");
        else traverse(child);
      }
    };
    traverse(this.root);
    return result;
  }

  loadSnapshot(snapshot: VirtualFSSnapshot): void {
    for (const [filePath, content] of Object.entries(snapshot)) {
      const norm = normalizePosixPath(filePath, this.currentWorkingDir);
      const segments = norm.split("/").filter(Boolean);
      if (segments.length > 1)
        this.mkdirSync("/" + segments.slice(0, -1).join("/"), { recursive: true });
      this.writeFileSync(norm, content);
    }
  }

  private createDirNode(name: string, path: string): VirtualDirNode {
    return {
      type: "dir",
      name,
      path,
      children: new Map<string, VirtualFSNode>(),
      stats: new VirtualStats({ isDir: true }),
    };
  }

  private lookupNode(norm: string): {
    node: VirtualFSNode | undefined;
    parent: VirtualDirNode | undefined;
    name: string;
  } {
    if (norm === "/") return { node: this.root, parent: undefined, name: "" };
    const segments = norm.split("/").filter(Boolean);
    let current: VirtualFSNode = this.root;
    let parent: VirtualDirNode | undefined;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      if (current.type !== "dir") return { node: undefined, parent: undefined, name: seg };
      parent = current;
      const next = current.children.get(seg);
      if (!next) return { node: undefined, parent, name: seg };
      current = next;
    }
    return { node: current, parent, name: segments[segments.length - 1]! };
  }

  private resolveParent(norm: string, syscall: string): { parent: VirtualDirNode; name: string } {
    const segments = norm.split("/").filter(Boolean);
    const leaf = segments[segments.length - 1]!;
    const parentPath = segments.length <= 1 ? "/" : "/" + segments.slice(0, -1).join("/");
    const { node } = this.lookupNode(parentPath);
    if (!node) throw VirtualFSError.enoent(parentPath, syscall);
    if (node.type !== "dir") throw VirtualFSError.enotdir(parentPath, syscall);
    return { parent: node, name: leaf };
  }
}

export const virtualFS = new VirtualMemoryFS();
