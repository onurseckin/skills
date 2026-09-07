import { Buffer } from "node:buffer";
import {
  type VirtualDirNode,
  type VirtualFileNode,
  type VirtualFSNode,
  VirtualStats,
} from "./descriptors.ts";
import { VirtualFSError } from "./errors.ts";

export function normalizePosixPath(inputPath: string, cwd = "/"): string {
  const norm = inputPath.replace(/\\/g, "/");
  const combined = norm.startsWith("/") ? norm : `${cwd}/${norm}`;
  const resolved: string[] = [];
  for (const seg of combined.split("/")) {
    if (!seg || seg === ".") {
      continue;
    }
    if (seg === "..") {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  return "/" + resolved.join("/");
}

export function createDirNode(name: string, path: string, clockMs: number): VirtualDirNode {
  return {
    type: "dir",
    name,
    path,
    children: new Map<string, VirtualFSNode>(),
    stats: new VirtualStats({
      isDir: true,
      mtimeMs: clockMs,
      ctimeMs: clockMs,
      atimeMs: clockMs,
      birthtimeMs: clockMs,
    }),
  };
}

export function lookupNode(
  root: VirtualDirNode,
  norm: string,
): {
  node: VirtualFSNode | undefined;
  parent: VirtualDirNode | undefined;
  name: string;
} {
  if (norm === "/") {
    return { node: root, parent: undefined, name: "" };
  }
  const segments = norm.split("/").filter(Boolean);
  let current: VirtualFSNode = root;
  let parent: VirtualDirNode | undefined;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (current.type !== "dir") {
      return { node: undefined, parent: undefined, name: seg };
    }
    parent = current;
    const next = current.children.get(seg);
    if (!next) {
      return { node: undefined, parent, name: seg };
    }
    current = next;
  }
  return { node: current, parent, name: segments[segments.length - 1]! };
}

export function rebasePath(node: VirtualFSNode, newName: string, newPath: string): VirtualFSNode {
  if (node.type === "file") {
    const fileNode: VirtualFileNode = {
      type: "file",
      name: newName,
      path: newPath,
      data: node.data,
      stats: node.stats,
    };
    return fileNode;
  }
  const children = new Map<string, VirtualFSNode>();
  for (const [childName, child] of node.children) {
    children.set(childName, rebasePath(child, childName, `${newPath}/${childName}`));
  }
  return { type: "dir", name: newName, path: newPath, children, stats: node.stats };
}

export function resolveParent(
  root: VirtualDirNode,
  norm: string,
  syscall: string,
): { parent: VirtualDirNode; name: string } {
  const segments = norm.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1]!;
  const parentPath = segments.length <= 1 ? "/" : "/" + segments.slice(0, -1).join("/");
  const { node } = lookupNode(root, parentPath);
  if (!node) {
    throw VirtualFSError.enoent(parentPath, syscall);
  }
  if (node.type !== "dir") {
    throw VirtualFSError.enotdir(parentPath, syscall);
  }
  return { parent: node, name: leaf };
}

export function dumpTreeSnapshot(root: VirtualDirNode): Record<string, string> {
  const result: Record<string, string> = {};
  const traverse = (dir: VirtualDirNode): void => {
    for (const child of dir.children.values()) {
      if (child.type === "file") {
        result[child.path] = Buffer.from(child.data).toString("utf-8");
      } else {
        traverse(child);
      }
    }
  };
  traverse(root);
  return result;
}
