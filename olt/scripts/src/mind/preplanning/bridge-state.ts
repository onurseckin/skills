import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { RawBacklogItem, RawDefectItem, ThematicCluster } from "./types.ts";

function writeAtomicJsonl(filePath: string, lines: readonly string[]): void {
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });

  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const content = lines.length > 0 ? lines.join("\n") + "\n" : "";
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, filePath);
}

export function transitionBacklogItemsToPlanned(
  backlogFilePath: string,
  cluster: ThematicCluster,
): { updatedCount: number; totalCount: number } {
  if (!existsSync(backlogFilePath)) {
    return { updatedCount: 0, totalCount: 0 };
  }

  const rawContent = readFileSync(backlogFilePath, "utf-8");
  const lines = rawContent.split("\n");
  const newLines: string[] = [];
  let updatedCount = 0;
  let totalCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalCount++;

    try {
      const item = JSON.parse(trimmed) as RawBacklogItem;
      if (item && typeof item.id === "string" && cluster.backlog_item_ids.includes(item.id)) {
        const updatedItem: RawBacklogItem = {
          ...item,
          status: "PLANNED",
          plan_path: cluster.plan_path,
          planned_at: cluster.planned_at,
        };
        newLines.push(JSON.stringify(updatedItem));
        updatedCount++;
      } else {
        newLines.push(trimmed);
      }
    } catch {
      newLines.push(trimmed);
    }
  }

  writeAtomicJsonl(backlogFilePath, newLines);
  return { updatedCount, totalCount };
}

export function transitionDefectsToPlanned(
  defectsFilePath: string,
  cluster: ThematicCluster,
): { updatedCount: number; totalCount: number } {
  if (!existsSync(defectsFilePath)) {
    return { updatedCount: 0, totalCount: 0 };
  }

  const rawContent = readFileSync(defectsFilePath, "utf-8");
  const lines = rawContent.split("\n");
  const newLines: string[] = [];
  let updatedCount = 0;
  let totalCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalCount++;

    try {
      const defect = JSON.parse(trimmed) as RawDefectItem;
      if (defect && typeof defect.id === "string" && cluster.defect_ids.includes(defect.id)) {
        const updatedDefect: RawDefectItem = {
          ...defect,
          status: "PLANNED",
          plan_path: cluster.plan_path,
          planned_at: cluster.planned_at,
        };
        newLines.push(JSON.stringify(updatedDefect));
        updatedCount++;
      } else {
        newLines.push(trimmed);
      }
    } catch {
      newLines.push(trimmed);
    }
  }

  writeAtomicJsonl(defectsFilePath, newLines);
  return { updatedCount, totalCount };
}

export function resolveLedgerPath(
  relativePath: string,
  customPath?: string | undefined,
  rootDir?: string | undefined,
): string {
  if (customPath) {
    return isAbsolute(customPath) ? customPath : resolve(rootDir ?? process.cwd(), customPath);
  }
  return resolve(rootDir ?? process.cwd(), relativePath);
}

export function updateBridgeState(
  cluster: ThematicCluster,
  options?:
    | {
        backlogFile?: string | undefined;
        defectsFile?: string | undefined;
        rootDir?: string | undefined;
      }
    | undefined,
): { itemsUpdated: number; defectsUpdated: number } {
  const root = options?.rootDir ?? process.cwd();
  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), options?.backlogFile, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), options?.defectsFile, root);

  const backlogResult = transitionBacklogItemsToPlanned(backlogPath, cluster);
  const defectResult = transitionDefectsToPlanned(defectsPath, cluster);

  return {
    itemsUpdated: backlogResult.updatedCount,
    defectsUpdated: defectResult.updatedCount,
  };
}
