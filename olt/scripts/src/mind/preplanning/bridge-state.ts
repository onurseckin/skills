import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/fs/flock-ffi.ts";
import type { RawBacklogItem, RawDefectItem, ThematicCluster } from "./types.ts";

function withFileFlock<T>(targetFilePath: string, fn: () => T, timeoutMs = 5000): T {
  const dir = dirname(targetFilePath);
  const base = basename(targetFilePath, extname(targetFilePath));
  const locksDir = basename(dir) === ".olt" ? join(dir, "locks") : join(dir, ".olt", "locks");
  const flockPath = join(locksDir, `${base}.flock`);
  mkdirSync(locksDir, { recursive: true });
  let fd: number | undefined;
  let locked = false;
  try {
    fd = openSync(flockPath, constants.O_RDWR | constants.O_CREAT, 0o600);
    const start = Date.now();
    while (!locked) {
      try {
        locked = tryExclusiveFlock(fd);
      } catch (err) {
        throw new HarnessError(
          "INVALID_STATE",
          `Flock FFI acquisition failed for '${flockPath}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (locked) break;
      if (Date.now() - start > timeoutMs) {
        throw new HarnessError("LOCK_TIMEOUT", `Timed out acquiring flock lock: ${flockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    return fn();
  } finally {
    if (locked && fd !== undefined) {
      try {
        releaseFlock(fd);
      } catch {}
    }
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function withMultiFileFlock<T>(targetFilePaths: readonly string[], fn: () => T): T {
  const sortedPaths = [...new Set(targetFilePaths.filter((p) => existsSync(p)))].sort();
  function lockNext(index: number): T {
    if (index >= sortedPaths.length) {
      return fn();
    }
    return withFileFlock(sortedPaths[index]!, () => lockNext(index + 1));
  }
  return lockNext(0);
}

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
  return withFileFlock(backlogFilePath, () => {
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
  });
}

export function transitionDefectsToPlanned(
  defectsFilePath: string,
  cluster: ThematicCluster,
): { updatedCount: number; totalCount: number } {
  return withFileFlock(defectsFilePath, () => {
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
  });
}

export function resolveLedgerPath(
  relativePath: string,
  customPath?: string | undefined,
  rootDir?: string | undefined,
): string {
  const root = rootDir !== undefined ? rootDir : process.cwd();
  if (customPath) {
    return isAbsolute(customPath) ? customPath : resolve(root, customPath);
  }
  return resolve(root, relativePath);
}

export function updateBridgeStateBatch(
  clusters: readonly ThematicCluster[],
  options?:
    | {
        backlogFile?: string | undefined;
        defectsFile?: string | undefined;
        rootDir?: string | undefined;
      }
    | undefined,
): { itemsUpdated: number; defectsUpdated: number } {
  if (clusters.length === 0) return { itemsUpdated: 0, defectsUpdated: 0 };
  const root =
    options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
  const customBacklog = options !== undefined ? options.backlogFile : undefined;
  const customDefects = options !== undefined ? options.defectsFile : undefined;

  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), customBacklog, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), customDefects, root);

  const itemPlanMap = new Map<string, { plan_path: string; planned_at: string }>();
  const defectPlanMap = new Map<string, { plan_path: string; planned_at: string }>();

  for (const cluster of clusters) {
    for (const id of cluster.backlog_item_ids) {
      itemPlanMap.set(id, { plan_path: cluster.plan_path, planned_at: cluster.planned_at });
    }
    for (const id of cluster.defect_ids) {
      defectPlanMap.set(id, { plan_path: cluster.plan_path, planned_at: cluster.planned_at });
    }
  }

  const targetsToLock: string[] = [];
  if (itemPlanMap.size > 0 && existsSync(backlogPath)) targetsToLock.push(backlogPath);
  if (defectPlanMap.size > 0 && existsSync(defectsPath)) targetsToLock.push(defectsPath);

  return withMultiFileFlock(targetsToLock, () => {
    let itemsUpdated = 0;
    if (itemPlanMap.size > 0 && existsSync(backlogPath)) {
      const rawContent = readFileSync(backlogPath, "utf-8");
      const lines = rawContent.split("\n");
      const newLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const item = JSON.parse(trimmed) as RawBacklogItem;
          if (item && typeof item.id === "string" && itemPlanMap.has(item.id)) {
            const planInfo = itemPlanMap.get(item.id)!;
            const updatedItem: RawBacklogItem = {
              ...item,
              status: "PLANNED",
              plan_path: planInfo.plan_path,
              planned_at: planInfo.planned_at,
            };
            newLines.push(JSON.stringify(updatedItem));
            itemsUpdated++;
          } else {
            newLines.push(trimmed);
          }
        } catch {
          newLines.push(trimmed);
        }
      }
      writeAtomicJsonl(backlogPath, newLines);
    }

    let defectsUpdated = 0;
    if (defectPlanMap.size > 0 && existsSync(defectsPath)) {
      const rawContent = readFileSync(defectsPath, "utf-8");
      const lines = rawContent.split("\n");
      const newLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const defect = JSON.parse(trimmed) as RawDefectItem;
          if (defect && typeof defect.id === "string" && defectPlanMap.has(defect.id)) {
            const planInfo = defectPlanMap.get(defect.id)!;
            const updatedDefect: RawDefectItem = {
              ...defect,
              status: "PLANNED",
              plan_path: planInfo.plan_path,
              planned_at: planInfo.planned_at,
            };
            newLines.push(JSON.stringify(updatedDefect));
            defectsUpdated++;
          } else {
            newLines.push(trimmed);
          }
        } catch {
          newLines.push(trimmed);
        }
      }
      writeAtomicJsonl(defectsPath, newLines);
    }

    return { itemsUpdated, defectsUpdated };
  });
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
  return updateBridgeStateBatch([cluster], options);
}
