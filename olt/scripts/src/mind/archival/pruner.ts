import { readFileSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { type ConsolidateCapsulesOptions, type ConsolidateCapsulesResult } from "./types.ts";
import { archiveCapsule, pruneCapsuleBoilerplate } from "./validator.ts";

export function consolidateCapsules(
  capsulesDir: string,
  options: ConsolidateCapsulesOptions = {},
): ConsolidateCapsulesResult {
  if (!capsulesDir || !existsSync(capsulesDir)) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulesDir must exist: ${capsulesDir}`);
  }
  const resolvedCapsulesDir = resolve(capsulesDir);
  const stat = lstatSync(resolvedCapsulesDir);
  if (!stat.isDirectory()) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulesDir must be a directory: ${capsulesDir}`);
  }

  const targetArchiveDir = options.targetArchiveDir
    ? resolve(options.targetArchiveDir)
    : join(resolvedCapsulesDir, "archive");

  const retention = options.retentionGenerations ?? 2;
  const currentGen = options.currentGeneration;
  const cutoffGen = currentGen !== undefined ? currentGen - retention : undefined;
  const activeRunIdsSet = options.activeRunIds ? new Set(options.activeRunIds) : undefined;

  const pruneBoilerplate = options.pruneBoilerplate ?? true;

  const entries = readdirSync(resolvedCapsulesDir);
  const activeCapsules: string[] = [];
  const archivedCapsules: string[] = [];
  let prunedSubdirectoriesCount = 0;

  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "archive") continue;
    const fullPath = join(resolvedCapsulesDir, entry);
    let entryStat;
    try {
      entryStat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) continue;

    const isCapsule =
      existsSync(join(fullPath, "manifest.json")) ||
      existsSync(join(fullPath, "state.json")) ||
      existsSync(join(fullPath, "prompt.md"));

    if (!isCapsule) continue;

    let isLegacy = false;

    if (activeRunIdsSet !== undefined) {
      isLegacy = !activeRunIdsSet.has(entry);
    } else if (cutoffGen !== undefined) {
      const genMatch = entry.match(/(?:mind-)?gen[-_]?(\d+)/i);
      if (genMatch && genMatch[1]) {
        const parsedGen = Number.parseInt(genMatch[1], 10);
        if (Number.isFinite(parsedGen) && parsedGen <= cutoffGen) {
          isLegacy = true;
        }
      }
    }

    if (!isLegacy && activeRunIdsSet === undefined && cutoffGen === undefined) {
      try {
        const statePath = join(fullPath, "state.json");
        if (existsSync(statePath)) {
          const stateRaw = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
          const mindState = stateRaw["mind"] as Record<string, unknown> | undefined;
          const completionResult = stateRaw["completion_result"] as
            | Record<string, unknown>
            | undefined;
          if (mindState?.status === "rotated" || completionResult?.status === "complete") {
            if (typeof mindState?.generation === "number" && currentGen !== undefined) {
              if (mindState.generation <= currentGen - retention) {
                isLegacy = true;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }

    if (isLegacy) {
      const archiveRes = archiveCapsule(fullPath, {
        targetArchiveDir,
        pruneBoilerplate,
        overwrite: true,
        dryRun: options.dryRun,
      });
      archivedCapsules.push(entry);
      prunedSubdirectoriesCount += archiveRes.prunedDirectories.length;
    } else {
      activeCapsules.push(entry);
      if (pruneBoilerplate) {
        const pruneRes = pruneCapsuleBoilerplate(fullPath, { dryRun: options.dryRun });
        prunedSubdirectoriesCount += pruneRes.prunedDirectories.length;
      }
    }
  }

  return {
    capsulesDir: resolvedCapsulesDir,
    activeCapsules,
    archivedCapsules,
    prunedSubdirectoriesCount,
    archiveDir: targetArchiveDir,
  };
}
