import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRepo } from "./teardown.ts";
import type { ListWorktreesOptions, TrackWorktreeInfo } from "./types.ts";

export function listWorktrees(options?: ListWorktreesOptions): readonly TrackWorktreeInfo[] {
  const repo = resolveRepo(options?.repoRoot);
  const worktreesRoot = join(repo, ".olt", "worktrees");
  if (!existsSync(worktreesRoot)) return [];

  const entries = readdirSync(worktreesRoot, { withFileTypes: true });
  const results: TrackWorktreeInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "locks") continue;
    const entryName = entry.name;
    const worktreePath = join(worktreesRoot, entryName);
    const metaPath = join(worktreePath, ".worktree-meta.json");
    const lockPath = join(worktreesRoot, "locks", `${entryName}.lock`);

    if (existsSync(metaPath)) {
      try {
        const parsed: TrackWorktreeInfo = JSON.parse(readFileSync(metaPath, "utf-8"));
        const tier = parsed.tier ?? (entryName.startsWith("orch-") ? "orchestrator" : "track");
        if (options?.tier === "orchestrator" && tier !== "orchestrator") continue;
        if (options?.tier === "track" && tier === "orchestrator") continue;
        results.push({ ...parsed, tier });
        continue;
      } catch {}
    }

    const isOrch = entryName.startsWith("orch-");
    const domain = isOrch ? entryName.slice(5) : undefined;
    const tier = isOrch ? ("orchestrator" as const) : ("track" as const);
    const branch = isOrch ? `orch/${domain}` : `track/${entryName}`;

    if (options?.tier === "orchestrator" && !isOrch) continue;
    if (options?.tier === "track" && isOrch) continue;

    results.push({
      trackId: entryName,
      worktreeId: entryName,
      worktreePath,
      branch,
      baseBranch: "main",
      lockPath,
      createdAt: new Date().toISOString(),
      status: "active",
      tier,
      ...(domain ? { domain } : {}),
    });
  }

  return results;
}
