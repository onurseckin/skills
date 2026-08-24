import { cpSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";

/**
 * Safely removes a file or directory recursively without throwing.
 */
export function safeRemove(targetPath: string): void {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignored if target does not exist or cannot be removed
  }
}

/**
 * Idempotently creates or updates a symbolic link pointing to target.
 * If the link already points to target, skips recreation.
 * Falls back to recursive copy if symlinking fails.
 */
export function smartEnsureSymlink(target: string, linkPath: string): "skipped" | "created" {
  try {
    const lstat = lstatSync(linkPath);
    if (lstat.isSymbolicLink()) {
      try {
        const currentTarget = readlinkSync(linkPath);
        if (currentTarget === target) {
          return "skipped";
        }
      } catch {
        // Fall through to recreate
      }
    }
  } catch {
    // Does not exist, will create
  }

  safeRemove(linkPath);
  try {
    symlinkSync(target, linkPath);
    return "created";
  } catch {
    // If symlink fails, copy contents as fallback
    try {
      cpSync(target, linkPath, { recursive: true });
      return "created";
    } catch {
      return "skipped";
    }
  }
}
