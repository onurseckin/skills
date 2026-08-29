export const DEFAULT_DEFECTS_FILE = "olt/defects.jsonl";
export const CANONICAL_DEFECTS_FILE = "olt/defects.jsonl";
export const DEFAULT_COMPLETED_DEFECTS_FILE = "olt/completed-defects.jsonl";
export const CANONICAL_COMPLETED_DEFECTS_FILE = "olt/completed-defects.jsonl";

export function requireDistinctLedgerPaths(activePath: string, completedPath: string): void {
  if (resolve(activePath) === resolve(completedPath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "active and completed defect ledger paths must be distinct",
    );
  }
}
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  isTestEnvironment,
  resolveDefectsPath,
  resolveScratchDir,
} from "../../../core/shared/paths.ts";
import { withDefectLogMutationLock, replaceDefectLogFileUnlocked } from "../../../logging/lock.ts";
import { parseDefectsJsonl, serializeDefectsJsonl } from "../sync/lifecycle-sync.ts";
import type { DefectEntry, DefectHypothesis } from "../core/types.ts";

export interface LogBoundaryViolationOptions {
  readonly customPath?: string | undefined;
  readonly capsuleRoot?: string | undefined;
  readonly useTodo?: boolean | undefined;
}

export function resolveCanonicalDefectLogPath(customRoot?: string): string {
  return resolveDefectsPath(customRoot);
}

export function resolveDefectLogPath(customPath?: string): string {
  return resolveDefectsPath(undefined, customPath);
}

export function resolveCanonicalCompletedDefectsPath(customRoot?: string): string {
  const root = customRoot || (isTestEnvironment() ? resolveScratchDir() : process.cwd());
  return join(root, ".olt", "completed-defects.jsonl");
}

export function resolveCompletedDefectsPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  if (isTestEnvironment()) return join(resolveScratchDir(), "completed-defects.jsonl");
  return resolveCanonicalCompletedDefectsPath();
}

export function readExistingDefectLog(path: string, _operation = "Read defect log"): DefectEntry[] {
  if (!existsSync(path)) return [];
  try {
    return parseDefectsJsonl(readFileSync(path, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HarnessError("INTEGRITY", `Failed to read defect log ${path}: ${msg}`);
  }
}

export function readCompletedDefectsLog(customPath?: string): DefectEntry[] {
  const p = resolveCompletedDefectsPath(customPath);
  return readExistingDefectLog(p, "Read completed defects log");
}

export function writeCompletedDefectsLog(
  entries: readonly DefectEntry[],
  customPath?: string,
): void {
  const p = resolveCompletedDefectsPath(customPath);
  atomicWriteDefectLog(entries, p, "Write completed defects log");
}

export function atomicWriteDefectLog(
  entries: readonly DefectEntry[],
  path: string,
  _operation = "Write defect log",
): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  const raw = serializeDefectsJsonl(entries);
  withDefectLogMutationLock(path, () => {
    replaceDefectLogFileUnlocked(path, raw);
  });
}

export function appendDefectLogEntry(
  entry: DefectEntry,
  options?: LogBoundaryViolationOptions,
): string {
  const targetPath = options?.customPath
    ? resolve(options.customPath)
    : options?.capsuleRoot
      ? resolveCanonicalDefectLogPath(options.capsuleRoot)
      : resolveDefectLogPath();
  const parent = dirname(targetPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  return withDefectLogMutationLock(targetPath, () => {
    const existing = readExistingDefectLog(targetPath);
    const updated = [
      ...existing.filter(
        (e) => e.id !== entry.id && (!entry.dedup_key || e.dedup_key !== entry.dedup_key),
      ),
      entry,
    ];
    const raw = serializeDefectsJsonl(updated);
    replaceDefectLogFileUnlocked(targetPath, raw);
    return targetPath;
  });
}

export function appendCompletedDefectLogEntry(entry: DefectEntry, targetPath?: string): string {
  const p = resolveCompletedDefectsPath(targetPath);
  const parent = dirname(p);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  return withDefectLogMutationLock(p, () => {
    const existing = readExistingDefectLog(p);
    if (
      existing.some(
        (e) => e.id === entry.id || (entry.dedup_key && e.dedup_key === entry.dedup_key),
      )
    ) {
      return p;
    }
    const updated = [...existing, entry];
    const raw = serializeDefectsJsonl(updated);
    replaceDefectLogFileUnlocked(p, raw);
    return p;
  });
}

export function mergeDefectsById(
  existing: readonly DefectEntry[],
  incoming: readonly DefectEntry[],
): DefectEntry[] {
  const map = new Map<string, DefectEntry>();
  for (const e of existing) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return Array.from(map.values());
}

export function formulateBoundaryViolationHypothesis(defect: DefectEntry): DefectHypothesis {
  let rootCause = "Agent role confinement failure or unauthorized boundary breach.";
  let confidence = 0.98;
  const evidence: string[] = [];

  if (defect.observation) evidence.push(`Observation: ${defect.observation}`);
  if (defect.remediation) evidence.push(`Prescribed remediation: ${defect.remediation}`);
  if (defect.role) evidence.push(`Role: ${defect.role}`);
  if (defect.agent_id) evidence.push(`Agent ID: ${defect.agent_id}`);

  const vType = (defect.type || "").toLowerCase();
  const rawObs = (defect.observation || "").toLowerCase();

  if (
    vType.includes("coordinator_code_writing") ||
    (rawObs.includes("coordinator") && (rawObs.includes("code") || rawObs.includes("write")))
  ) {
    rootCause = "Tier 2 Coordinator breached zero-tolerance boundary (0 coordinator code writing).";
    confidence = 0.99;
  } else if (
    vType.includes("orchestrator_direct_implementation") ||
    (rawObs.includes("orchestrator") &&
      (rawObs.includes("task") || rawObs.includes("implementation")))
  ) {
    rootCause =
      "Tier 1 Orchestrator breached zero-tolerance boundary (0 orchestrator task implementations).";
    confidence = 0.99;
  } else if (vType.includes("unassigned_test_running") || rawObs.includes("unassigned test")) {
    rootCause = "Agent breached test running confinement (0 unassigned test running).";
    confidence = 0.97;
  } else if (vType.includes("cross_tier_spawning") || rawObs.includes("cross-tier")) {
    rootCause = "Supervisory agent bypassed 4-tier hierarchical spawning boundaries.";
    confidence = 0.98;
  }

  return {
    id: `hypo-${defect.id}`,
    defect_id: defect.id,
    root_cause: rootCause,
    confidence,
    category: "boundary_violation",
    evidence,
  };
}
