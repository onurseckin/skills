import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import type { DestructiveAuditEvent } from "../../olt/scripts/src/core/shared/safe-fs/index.ts";
import { guardedRemoveSync, logDestructiveOp } from "./fs-helpers.ts";

export const PRESERVED_MIRROR_ENTRIES = [
  ".capsules",
  ".olt",
  ".olt-sync-managed.json",
  ".tmp",
  "installation.json",
  "node_modules",
  "skill-config.json",
] as const;

export interface PruneMirrorOptions {
  readonly sourceDir: string;
  readonly mirrorDir: string;
  readonly mirrorRoot: string;
  readonly apply?: boolean;
  readonly onAudit?: (event: DestructiveAuditEvent) => void;
}

export interface PruneMirrorResult {
  readonly applied: boolean;
  readonly mirrorDir: string;
  readonly stalePaths: readonly string[];
}

export function isPreservedEntry(relativePath: string): boolean {
  const head = relativePath.split(sep)[0];
  if (head === undefined) {
    return false;
  }
  const preserved: readonly string[] = PRESERVED_MIRROR_ENTRIES;
  return preserved.includes(head);
}

export function assertInsideMirrorRoot(candidate: string, mirrorRoot: string): string {
  const root = resolve(mirrorRoot);
  const target = resolve(candidate);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target === root || !target.startsWith(rootWithSep)) {
    const issue: JsonObject = { candidate: target, mirrorRoot: root };
    throw new HarnessError(
      "PATH_SAFETY",
      `sync prune refuses '${target}': every pruned path must resolve strictly inside the skill mirror root '${root}'`,
      [issue],
    );
  }
  return target;
}

function isMirrorDirectory(entryPath: string): boolean {
  try {
    return lstatSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function listMirrorEntries(dirPath: string): string[] {
  try {
    return [...readdirSync(dirPath)].sort();
  } catch {
    return [];
  }
}

export function collectStalePaths(sourceDir: string, mirrorDir: string): string[] {
  const stale: string[] = [];
  const walk = (relativeDir: string): void => {
    const scanned = relativeDir === "" ? mirrorDir : join(mirrorDir, relativeDir);
    for (const name of listMirrorEntries(scanned)) {
      const relativePath = relativeDir === "" ? name : join(relativeDir, name);
      if (isPreservedEntry(relativePath)) {
        continue;
      }
      if (!existsSync(join(sourceDir, relativePath))) {
        stale.push(relativePath);
        continue;
      }
      if (isMirrorDirectory(join(mirrorDir, relativePath))) {
        walk(relativePath);
      }
    }
  };
  walk("");
  return stale;
}

export function pruneMirror(options: PruneMirrorOptions): PruneMirrorResult {
  const mirrorRoot = resolve(options.mirrorRoot);
  const mirrorDir = resolve(options.mirrorDir);
  if (mirrorDir !== mirrorRoot) {
    assertInsideMirrorRoot(mirrorDir, mirrorRoot);
  }
  if (!existsSync(mirrorDir) || !existsSync(options.sourceDir)) {
    return { applied: false, mirrorDir, stalePaths: [] };
  }

  const stalePaths = collectStalePaths(options.sourceDir, mirrorDir);
  if (options.apply !== true) {
    return { applied: false, mirrorDir, stalePaths };
  }

  const onAudit = options.onAudit !== undefined ? options.onAudit : logDestructiveOp;
  for (const relativePath of stalePaths) {
    const target = assertInsideMirrorRoot(join(mirrorDir, relativePath), mirrorRoot);
    guardedRemoveSync(target, {
      allowedRoots: [mirrorRoot],
      missingOk: true,
      onAudit,
    });
  }
  return { applied: true, mirrorDir, stalePaths };
}

export function formatPruneReport(results: readonly PruneMirrorResult[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const result of results) {
    total += result.stalePaths.length;
    if (result.stalePaths.length === 0) {
      lines.push(`[sync-prune] ${result.mirrorDir}: tree matches source, nothing stale.`);
      continue;
    }
    const verb = result.applied ? "removed" : "would remove (dry run)";
    lines.push(`[sync-prune] ${result.mirrorDir}: ${verb} ${result.stalePaths.length} entries:`);
    for (const relativePath of result.stalePaths) {
      lines.push(`[sync-prune]   ${relativePath}`);
    }
  }
  if (total > 0 && results.every((result) => !result.applied)) {
    lines.push("[sync-prune] Dry run is the default; pass --prune to remove these entries.");
  }
  return lines.join("\n");
}
