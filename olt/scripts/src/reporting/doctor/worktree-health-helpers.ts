import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGit, type GitRunner } from "../../workflow/worktree/git-ops.ts";
import type { TrackWorktreeInfo } from "../../workflow/worktree/manager.ts";
import type { WorktreeHealthOptions } from "./worktree-health-engine.ts";

export interface ParsedLockFile {
  readonly pid?: number;
  readonly trackId?: string;
  readonly created_at?: string;
  readonly createdAt?: string;
}

export function parseTrackLock(lockPath: string): {
  data: ParsedLockFile | null;
  isCorrupt: boolean;
} {
  try {
    if (!existsSync(lockPath)) return { data: null, isCorrupt: false };
    const content = readFileSync(lockPath, "utf8").trim();
    if (!content) return { data: null, isCorrupt: true };
    const data = JSON.parse(content) as ParsedLockFile;
    return typeof data === "object" && data !== null
      ? { data, isCorrupt: false }
      : { data: null, isCorrupt: true };
  } catch {
    return { data: null, isCorrupt: true };
  }
}

export function isBranchMerged(
  repoRoot: string,
  branch: string,
  baseBranch = "main",
  runner = runGit,
): boolean {
  try {
    const res = runner(repoRoot, ["branch", "--merged", baseBranch]);
    return (
      res.status === 0 &&
      res.stdout
        .split("\n")
        .map((b) => b.trim().replace(/^[*+]\s+/, ""))
        .includes(branch)
    );
  } catch {
    return false;
  }
}

export function getGitWorktreePaths(repoRoot: string, runner = runGit): readonly string[] {
  try {
    const res = runner(repoRoot, ["worktree", "list", "--porcelain"]);
    return res.status === 0
      ? res.stdout
          .split("\n")
          .filter((l) => l.startsWith("worktree "))
          .map((l) => resolve(l.slice(9).trim()))
      : [];
  } catch {
    return [];
  }
}

export function findPrunableWorktrees(repoRoot: string, runner = runGit): readonly string[] {
  try {
    const res = runner(repoRoot, ["worktree", "list", "--porcelain"]);
    if (res.status !== 0) return [];
    const prunable: string[] = [];
    let cur = "";
    let isPrun = false;
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        cur = line.slice(9).trim();
        isPrun = false;
      } else if (line.startsWith("prunable")) {
        isPrun = true;
      } else if (!line && cur) {
        if (isPrun || (!existsSync(cur) && cur.includes(".olt"))) prunable.push(cur);
        cur = "";
        isPrun = false;
      }
    }
    if (cur && (isPrun || (!existsSync(cur) && cur.includes(".olt")))) prunable.push(cur);
    return prunable;
  } catch {
    return [];
  }
}

export function reconcileUntrackedWorktrees(
  activeTrackWorktrees: readonly TrackWorktreeInfo[],
  rawTrackWorktrees: readonly TrackWorktreeInfo[],
  options: WorktreeHealthOptions,
  addFinding: (
    code: string,
    severity: "WARN" | "ERROR",
    issue: string,
    details?: Record<string, unknown>,
  ) => void,
): void {
  const tasksInput =
    options.tasks ?? (options.state?.tasks as Readonly<Record<string, unknown>> | null | undefined);
  if (options.tasks === undefined && options.state === undefined) return;

  const knownTrackIds = new Set<string>();
  if (tasksInput && typeof tasksInput === "object") {
    for (const [key, val] of Object.entries(tasksInput)) {
      knownTrackIds.add(key);
      if (val && typeof val === "object") {
        const r = val as Record<string, unknown>;
        if (typeof r.id === "string") knownTrackIds.add(r.id);
        if (typeof r.trackId === "string") knownTrackIds.add(r.trackId);
        if (typeof r.track_id === "string") knownTrackIds.add(r.track_id);
        if (typeof r.track === "string") knownTrackIds.add(r.track);
        if (typeof r.worktree === "string") knownTrackIds.add(r.worktree);
        if (r.lease && typeof r.lease === "object") {
          const l = r.lease as Record<string, unknown>;
          if (typeof l.trackId === "string") knownTrackIds.add(l.trackId);
          if (typeof l.track_id === "string") knownTrackIds.add(l.track_id);
        }
      }
    }
  }

  if (options.state && typeof options.state === "object") {
    const st = options.state as Record<string, unknown>;
    const collect = (list: unknown) => {
      if (Array.isArray(list)) {
        for (const item of list) {
          if (typeof item === "string") knownTrackIds.add(item);
          else if (item && typeof item === "object") {
            const r = item as Record<string, unknown>;
            if (typeof r.trackId === "string") knownTrackIds.add(r.trackId);
            if (typeof r.track_id === "string") knownTrackIds.add(r.track_id);
            if (typeof r.id === "string") knownTrackIds.add(r.id);
          }
        }
      }
    };
    collect(st.active_tracks);
    collect(st.tracks);
    collect(st.track_reservations);
    collect(st.reservations);
    collect(st.planning_buffer);
  }

  const untrackedSeen = new Set<string>();
  const worktreesToCheck = [...activeTrackWorktrees];
  for (const r of rawTrackWorktrees) {
    if (!worktreesToCheck.some((w) => w.trackId === r.trackId)) worktreesToCheck.push(r);
  }

  for (const wt of worktreesToCheck) {
    const isAssociated =
      knownTrackIds.has(wt.trackId) ||
      [...knownTrackIds].some(
        (k) =>
          k === wt.trackId ||
          wt.trackId === `track-${k}` ||
          k === `track-${wt.trackId}` ||
          wt.trackId.startsWith(k) ||
          k.startsWith(wt.trackId),
      );
    if (!isAssociated && !untrackedSeen.has(wt.trackId)) {
      untrackedSeen.add(wt.trackId);
      addFinding(
        "UNTRACKED_WORKTREE_DETECTED",
        "ERROR",
        `Untracked worktree '${wt.trackId}' detected without associated task or track reservation`,
        { trackId: wt.trackId, worktreePath: wt.worktreePath },
      );
    }
  }
}
