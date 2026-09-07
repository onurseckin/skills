import { join } from "node:path";
import {
  clusterBacklogAndDefects,
  loadBacklogItems,
  loadDefectItems,
  resolveLedgerPath,
  type RawBacklogItem,
  type RawDefectItem,
} from "../../preplanning/index.ts";
import { listWorktrees } from "../../../workflow/worktree/index.ts";

export interface AntiStagnationAuditOptions {
  readonly rootDir?: string;
  readonly backlogFile?: string;
  readonly defectsFile?: string;
  readonly explicitBacklog?: readonly RawBacklogItem[];
  readonly explicitDefects?: readonly RawDefectItem[];
}

export interface AntiStagnationResult {
  readonly worktreeOccupancy: number;
  readonly disjointClusterCount: number;
  readonly provocationDelivered: boolean;
  readonly message?: string;
}

export function auditAntiStagnationPassivity(
  options?: AntiStagnationAuditOptions,
): AntiStagnationResult {
  const root = options?.rootDir ?? process.cwd();

  let backlogItems = options?.explicitBacklog;
  if (!backlogItems) {
    const backlogPath = resolveLedgerPath(
      join(".olt", "backlog.jsonl"),
      options?.backlogFile,
      root,
    );
    backlogItems = loadBacklogItems(backlogPath);
  }

  let defectItems = options?.explicitDefects;
  if (!defectItems) {
    const defectsPath = resolveLedgerPath(
      join(".olt", "defects.jsonl"),
      options?.defectsFile,
      root,
    );
    defectItems = loadDefectItems(defectsPath);
  }

  const clusters = clusterBacklogAndDefects(backlogItems, defectItems, { rootDir: root });
  const disjointClusterCount = clusters.length;

  const worktrees = listWorktrees({ repoRoot: root });
  const activeWorktrees = worktrees.filter((wt) => wt.status === "active");
  const worktreeOccupancy = activeWorktrees.length;

  let provocationDelivered = false;
  let message: string | undefined;

  if (disjointClusterCount > 1 && worktreeOccupancy <= 1) {
    provocationDelivered = true;
    message = `SOCRATIC PROVOCATION: Worktree occupancy is critically low (${worktreeOccupancy}) despite the presence of multiple disjoint backlog clusters (${disjointClusterCount}). Expand worktree concurrency immediately to process parallelizable domains.`;
  }

  return {
    worktreeOccupancy,
    disjointClusterCount,
    provocationDelivered,
    message: message ?? "Completed",
  };
}
