import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SyncSourceDecision =
  | { readonly mode: "head" }
  | { readonly mode: "worktree" }
  | { readonly mode: "refuse"; readonly dirtyPaths: readonly string[] };

export interface ResolvedOltSource {
  sourceOltDir: string;
  cleanup: () => void;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return "unknown error";
}

export function decideSyncSource(
  dirtyPaths: readonly string[],
  allowDirty: boolean,
): SyncSourceDecision {
  if (allowDirty) {
    return { mode: "worktree" };
  }
  if (dirtyPaths.length > 0) {
    return { mode: "refuse", dirtyPaths: [...dirtyPaths] };
  }
  return { mode: "head" };
}

export function parsePorcelainStatus(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => {
      const rawPath = line.slice(3);
      const arrowIndex = rawPath.indexOf(" -> ");
      return arrowIndex === -1 ? rawPath : rawPath.slice(arrowIndex + 4);
    });
}

export function getDirtyOltPaths(repoRoot: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain", "--", "olt/"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git status --porcelain -- olt/ failed in ${repoRoot}: ${firstNonEmpty(result.stderr, result.error?.message)}`,
    );
  }
  return parsePorcelainStatus(result.stdout);
}

export function refuseSyncSourceMessage(dirtyPaths: readonly string[]): string {
  const list = dirtyPaths.map((path) => `  ${path}`).join("\n");
  return `refusing to sync from a dirty olt/ tree; commit these paths or pass --allow-dirty:\n${list}`;
}

export function materializeOltFromHead(repoRoot: string, tmpParentDir?: string): ResolvedOltSource {
  let tmpParent: string;
  if (tmpParentDir !== undefined) {
    tmpParent = tmpParentDir;
  } else {
    tmpParent = tmpdir();
  }
  mkdirSync(tmpParent, { recursive: true });
  const extractDir = mkdtempSync(join(tmpParent, "olt-sync-head-"));

  const archiveResult = spawnSync("git", ["archive", "--format=tar", "HEAD", "--", "olt/"], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 256,
  });
  if (archiveResult.status !== 0) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new Error(
      `git archive HEAD -- olt/ failed in ${repoRoot}: ${firstNonEmpty(archiveResult.stderr?.toString(), archiveResult.error?.message)}`,
    );
  }
  if (!archiveResult.stdout) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new Error(`git archive HEAD -- olt/ produced no output in ${repoRoot}`);
  }

  const extractResult = spawnSync("tar", ["-x", "-C", extractDir], {
    input: archiveResult.stdout,
  });
  if (extractResult.status !== 0) {
    rmSync(extractDir, { recursive: true, force: true });
    throw new Error(
      `failed to extract HEAD olt/ archive into ${extractDir}: ${firstNonEmpty(extractResult.stderr?.toString(), extractResult.error?.message)}`,
    );
  }

  return {
    sourceOltDir: join(extractDir, "olt"),
    cleanup: () => rmSync(extractDir, { recursive: true, force: true }),
  };
}

export function resolveOltSyncSource(repoRoot: string, allowDirty: boolean): ResolvedOltSource {
  const dirtyPaths = getDirtyOltPaths(repoRoot);
  const decision = decideSyncSource(dirtyPaths, allowDirty);

  if (decision.mode === "refuse") {
    throw new Error(refuseSyncSourceMessage(decision.dirtyPaths));
  }
  if (decision.mode === "worktree") {
    return { sourceOltDir: join(repoRoot, "olt"), cleanup: () => {} };
  }
  return materializeOltFromHead(repoRoot);
}
