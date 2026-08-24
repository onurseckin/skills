import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
  SKILL_CONFIG: "skill-config.json",
  QUOTA_DAG_SNAPSHOT: "quota-dag-snapshot.json",
} as const;

function unsafe(message: string): never {
  throw new HarnessError("PATH_SAFETY", message);
}

/**
 * Returns true if the target path is located inside or is a capsule directory.
 * Matches `/.olt/capsules/`, `/.capsules/`, or paths ending with capsule directory identifiers.
 */
export function isInsideCapsule(targetPath: string): boolean {
  const normalized = resolve(targetPath).split(sep).join("/");
  return (
    normalized.includes("/.olt/capsules/") ||
    normalized.endsWith("/.olt/capsules") ||
    normalized.includes("/.capsules/") ||
    normalized.endsWith("/.capsules")
  );
}

/**
 * Extracts the enclosing sovereign repository root prefix if the path is inside a capsule.
 * Returns undefined if the path is not inside a capsule.
 */
export function stripCapsulePath(targetPath: string): string | undefined {
  const normalized = resolve(targetPath);
  const oltCapsulesPattern = `${sep}.olt${sep}capsules`;
  const oltCapsulesIdx = normalized.indexOf(oltCapsulesPattern);
  if (oltCapsulesIdx !== -1) {
    return normalized.slice(0, oltCapsulesIdx) || sep;
  }
  const dotCapsulesPattern = `${sep}.capsules`;
  const dotCapsulesIdx = normalized.indexOf(dotCapsulesPattern);
  if (dotCapsulesIdx !== -1) {
    return normalized.slice(0, dotCapsulesIdx) || sep;
  }
  return undefined;
}

/**
 * Deterministically locates the sovereign repository root.
 * Proactively strips capsule segments and walks up the directory hierarchy.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  const resolvedStart = resolve(startDir);
  const stripped = stripCapsulePath(resolvedStart);
  let current = stripped ?? resolvedStart;

  while (true) {
    const isExcluded =
      current.endsWith("/olt/scripts") ||
      current.endsWith("/olt") ||
      current.endsWith("/.olt") ||
      isInsideCapsule(current);

    if (!isExcluded) {
      const hasOlt = existsSync(join(current, OLT_DIR_NAME));
      const hasGit = existsSync(join(current, ".git"));
      const hasPkg = existsSync(join(current, "package.json"));

      if (hasOlt || hasGit || hasPkg) {
        return current;
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return stripped ?? resolvedStart;
}

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

export function resolveScratchDir(_repoRoot?: string): string {
  const pid = typeof process !== "undefined" ? process.pid : 0;
  return join(tmpdir(), "olt-scratch", String(pid));
}

function resolveSafeRoot(repoRoot?: string): string {
  if (repoRoot) {
    const resolved = resolve(repoRoot);
    if (isTestEnvironment() && resolved === findRepoRoot()) {
      return resolveScratchDir();
    }
    return resolved;
  }
  if (isTestEnvironment()) {
    return resolveScratchDir();
  }
  return findRepoRoot();
}

/**
 * Idempotently resolves the canonical `.olt` directory for a repository.
 */
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

/**
 * Idempotently resolves the canonical `.olt/capsules` directory.
 */
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
  return join(root, OLT_DIR_NAME, CAPSULES_DIR_NAME);
}

export function resolvePolicyPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  return join(root, OLT_DIR_NAME, OLT_FILES.POLICY);
}

export function resolveBacklogPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.BACKLOG);
}

export function resolveCompletedTasksPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_TASKS);
}

export function resolveDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.DEFECTS);
}

export function resolveCompletedDefectsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.COMPLETED_DEFECTS);
}

export function resolveTelemetryPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.TELEMETRY);
}

export function resolveMemoryPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.MEMORY);
}

export function resolveWatchdogsPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.WATCHDOGS);
}

export function resolveQuotaDagSnapshotPath(repoRoot?: string, customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = resolveSafeRoot(repoRoot);
  return join(root, OLT_DIR_NAME, OLT_FILES.QUOTA_DAG_SNAPSHOT);
}

export function resolveEvidenceDir(repoRoot?: string, runRoot?: string): string {
  if (runRoot && existsSync(runRoot)) {
    return join(runRoot, "evidence");
  }
  return join(resolveScratchDir(), "evidence");
}

export interface SkillGlobalConfig {
  readonly home_repo_root: string;
  readonly synced_at: string;
  readonly version: string;
}

export function resolveSkillGlobalConfigPath(): string {
  return join(homedir(), ".agents", "skills", "olt", "skill-config.json");
}

export function loadSkillGlobalConfig(): SkillGlobalConfig | null {
  try {
    const p = resolveSkillGlobalConfigPath();
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "home_repo_root" in parsed &&
        typeof (parsed as { home_repo_root: unknown }).home_repo_root === "string"
      ) {
        return parsed as SkillGlobalConfig;
      }
    }
  } catch {
    // Ignore error and fall through
  }
  return null;
}

export function resolveSkillHomeRepo(currentRepoRoot?: string): string {
  if (process.env["OLT_SKILL_HOME_REPO"] && existsSync(process.env["OLT_SKILL_HOME_REPO"])) {
    return resolve(process.env["OLT_SKILL_HOME_REPO"]);
  }
  const cfg = loadSkillGlobalConfig();
  if (cfg && existsSync(cfg.home_repo_root)) {
    return resolve(cfg.home_repo_root);
  }
  const root = currentRepoRoot ? resolve(currentRepoRoot) : findRepoRoot();
  if (existsSync(join(root, "olt", "agents")) || existsSync(join(root, "olt", "scripts"))) {
    return root;
  }
  return root;
}
