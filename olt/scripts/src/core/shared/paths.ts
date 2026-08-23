import { existsSync, lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export const OLT_DIR_NAME = ".olt";
export const CAPSULES_DIR_NAME = "capsules";

export const OLT_FILES = {
  POLICY: "policy.json",
  BACKLOG: "backlog.jsonl",
  COMPLETED_TASKS: "completed-tasks.jsonl",
  DEFECTS: "defects.jsonl",
  COMPLETED_DEFECTS: "completed-defects.jsonl",
  TELEMETRY: "telemetry.jsonl",
  MEMORY: "memory.json",
  WATCHDOGS: "watchdogs.json",
} as const;

function unsafe(message: string): never {
  throw new HarnessError("PATH_SAFETY", message);
}

export function findRepoRoot(startDir: string = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, OLT_DIR_NAME)) ||
      existsSync(join(current, ".git")) ||
      existsSync(join(current, "package.json"))
    ) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return resolve(startDir);
}

export function resolveOltDir(repoRoot?: string): string {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME);
}

export function resolveCapsulesDir(repoRoot?: string): string {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, CAPSULES_DIR_NAME);
}

export function resolvePolicyPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.POLICY);
}

export function resolveBacklogPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.BACKLOG);
}

export function resolveCompletedTasksPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_TASKS);
}

export function resolveDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.DEFECTS);
}

export function resolveCompletedDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_DEFECTS);
}

export function resolveTelemetryPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.TELEMETRY);
}

export function resolveMemoryPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.MEMORY);
}

export function resolveWatchdogsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.WATCHDOGS);
}

export function resolveScratchDir(_repoRoot?: string): string {
  return join(tmpdir(), "olt-scratch");
}

export function resolveEvidenceDir(repoRoot?: string, runRoot?: string): string {
  if (runRoot && existsSync(runRoot)) {
    return join(runRoot, "evidence");
  }
  return join(resolveScratchDir(), "evidence");
}
