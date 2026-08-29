import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

export const MIN_PATH_SEGMENTS = 3;

export function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function realpathOfExistingAncestor(target: string): string {
  const resolved = resolve(target);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(resolved);
    if (parent === resolved) return resolved;
    return resolve(realpathOfExistingAncestor(parent), basename(resolved));
  }
}

export function canonicalizeTarget(target: string): string {
  const resolved = resolve(target);
  const parent = dirname(resolved);
  if (parent === resolved) return resolved;
  const realParent = realpathOfExistingAncestor(parent);
  return resolve(realParent, basename(resolved));
}

export function segmentCount(target: string): number {
  return target.split(sep).filter((segment) => segment.length > 0).length;
}

export function isSelfOrStrictAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const withSep = ancestor.endsWith(sep) ? ancestor : ancestor + sep;
  return descendant.startsWith(withSep);
}
