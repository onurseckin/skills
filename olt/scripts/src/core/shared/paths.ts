import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  CAPSULES_DIR_NAME,
  OLT_DIR_NAME,
  OLT_FILES,
  findRepoRoot,
  isInsideCapsule,
  stripCapsulePath,
} from "./repo-root.ts";
import {
  isSkillHomeRepoRoot,
  loadSkillGlobalConfig,
  resolveGlobalSkillDir,
  resolveSkillGlobalConfigPath,
  resolveSkillHomeRepo,
  type SkillGlobalConfig,
} from "./skill-home.ts";

export {
  CAPSULES_DIR_NAME,
  OLT_DIR_NAME,
  OLT_FILES,
  findRepoRoot,
  isInsideCapsule,
  stripCapsulePath,
  isSkillHomeRepoRoot,
  loadSkillGlobalConfig,
  resolveGlobalSkillDir,
  resolveSkillGlobalConfigPath,
  resolveSkillHomeRepo,
  type SkillGlobalConfig,
};

export function isTestEnvironment(): boolean {
  if (typeof process === "undefined") return false;
  if (
    process.env["NODE_ENV"] === "test" ||
    process.env["BUN_TEST"] !== undefined ||
    process.env["TEST"] !== undefined
  ) {
    return true;
  }
  if (Array.isArray(process.argv)) {
    return process.argv.some(
      (arg) => typeof arg === "string" && (arg.includes("test") || arg.includes("bun:test")),
    );
  }
  return false;
}

const SANDBOX_ROOT_PREFIXES = ["/virtual", "/fixture", "/virtual-fs"] as const;

export function isSandboxRepoRoot(root: string | undefined): boolean {
  if (typeof root !== "string" || root.length === 0) return false;
  return SANDBOX_ROOT_PREFIXES.some(
    (prefix) => root === prefix || root.startsWith(`${prefix}/`) || root.includes(`${prefix}/`),
  );
}

export function resolveScratchDir(_repoRoot?: string): string {
  const pid = typeof process !== "undefined" ? process.pid : 0;
  return join(tmpdir(), "olt-scratch", String(pid));
}

function resolveSafeRoot(repoRoot?: string): string {
  if (repoRoot) {
    const resolved = resolve(repoRoot);
    try {
      if (isTestEnvironment() && resolved === findRepoRoot()) {
        return resolveScratchDir();
      }
    } catch {}
    return resolved;
  }
  if (isTestEnvironment()) {
    return resolveScratchDir();
  }
  return findRepoRoot();
}

export function resolveOltDir(repoRoot?: string): string {
  let root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (isInsideCapsule(root)) {
    root = findRepoRoot(root);
  }
  if (root.endsWith(`${sep}${OLT_DIR_NAME}`)) {
    return root;
  }
  return join(root, OLT_DIR_NAME);
}

export function resolveCapsulesDir(repoRoot?: string): string {
  let root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (isInsideCapsule(root)) {
    root = findRepoRoot(root);
  }
  const canonicalSuffix = `${sep}${OLT_DIR_NAME}${sep}${CAPSULES_DIR_NAME}`;
  if (root.endsWith(canonicalSuffix)) {
    return root;
  }
  if (root.endsWith(`${sep}${OLT_DIR_NAME}`)) {
    return join(root, CAPSULES_DIR_NAME);
  }
  const direct = join(root, OLT_DIR_NAME, CAPSULES_DIR_NAME);
  if (existsSync(direct)) {
    return direct;
  }
  const worktreeIdx = root.indexOf(`${sep}.olt${sep}worktrees`);
  if (worktreeIdx !== -1) {
    const parentRepo = root.slice(0, worktreeIdx);
    const parentCapsules = join(parentRepo, OLT_DIR_NAME, CAPSULES_DIR_NAME);
    if (existsSync(parentCapsules)) {
      return parentCapsules;
    }
  }
  return direct;
}

export function resolvePolicyPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.POLICY);
}

function resolveOltFilePath(file: string, repoRoot?: string, custom?: string): string {
  if (custom && custom.trim()) return resolve(custom.trim());
  return join(resolveSafeRoot(repoRoot), OLT_DIR_NAME, file);
}

export const resolveBacklogPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.BACKLOG, r, c);
export const resolveCompletedTasksPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.COMPLETED_TASKS, r, c);
export const resolveDefectsPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.DEFECTS, r, c);
export const resolveCompletedDefectsPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.COMPLETED_DEFECTS, r, c);
export const resolveTelemetryPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.TELEMETRY, r, c);
export const resolveMemoryPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.MEMORY, r, c);
export const resolveWatchdogsPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.WATCHDOGS, r, c);
export const resolveQuotaDagSnapshotPath = (r?: string, c?: string): string =>
  resolveOltFilePath(OLT_FILES.QUOTA_DAG_SNAPSHOT, r, c);

export function resolveEvidenceDir(repoRoot?: string, runRoot?: string): string {
  if (runRoot && existsSync(runRoot)) {
    return join(runRoot, "evidence");
  }
  return join(resolveScratchDir(), "evidence");
}
