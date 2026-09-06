import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { HarnessError } from "../errors/index.ts";

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
  const n = resolve(targetPath).split(sep).join("/");
  return (
    n.includes("/.olt/capsules/") ||
    n.endsWith("/.olt/capsules") ||
    n.includes("/.capsules/") ||
    n.endsWith("/.capsules")
  );
}

export function stripCapsulePath(targetPath: string): string | undefined {
  const norm = resolve(targetPath);
  for (const pat of [`${sep}.olt${sep}capsules`, `${sep}.capsules`]) {
    const idx = norm.indexOf(pat);
    if (idx !== -1) return norm.slice(0, idx) || sep;
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

  unsafe(
    `findRepoRoot: no repository anchor (.git, .olt, or package.json) found walking up from '${resolvedStart}'; refusing to guess a repo root`,
  );
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
      const parsed = JSON.parse(readFileSync(p, "utf-8")) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "home_repo_root" in parsed &&
        typeof (parsed as { home_repo_root: unknown }).home_repo_root === "string"
      ) {
        return parsed as SkillGlobalConfig;
      }
    }
  } catch {}
  return null;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  return p.startsWith(`~${sep}`) || p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function readPolicyDefectConfig(repoRoot?: string): {
  skill_home?: string | undefined;
  global_skill_dir?: string | undefined;
} {
  const roots: string[] = [];
  if (repoRoot?.trim()) roots.push(resolve(repoRoot.trim()));
  try {
    const sovereign = findRepoRoot();
    if (!roots.includes(sovereign)) roots.push(sovereign);
  } catch {}

  let skill_home: string | undefined;
  let global_skill_dir: string | undefined;

  for (const root of roots) {
    for (const sub of [
      join(OLT_DIR_NAME, OLT_FILES.POLICY),
      join("olt", OLT_FILES.POLICY),
      OLT_FILES.POLICY,
    ]) {
      try {
        const filePath = join(root, sub);
        if (!existsSync(filePath)) continue;
        const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const rec = parsed as Record<string, unknown>;
        const dr = rec["defect_routing"] as Record<string, unknown> | undefined;
        if (dr && typeof dr === "object" && !Array.isArray(dr)) {
          if (!skill_home && typeof dr["skill_home_repo_root"] === "string") {
            skill_home = dr["skill_home_repo_root"].trim();
          }
          if (!global_skill_dir && typeof dr["global_skill_dir"] === "string") {
            global_skill_dir = dr["global_skill_dir"].trim();
          }
        }
        if (!skill_home && typeof rec["skill_home_repo_root"] === "string") {
          skill_home = rec["skill_home_repo_root"].trim();
        }
        if (skill_home && global_skill_dir) return { skill_home, global_skill_dir };
      } catch {}
    }
  }
  return { skill_home, global_skill_dir };
}

export function resolveGlobalSkillDir(currentRepoRoot?: string): string {
  const { global_skill_dir } = readPolicyDefectConfig(currentRepoRoot);
  return global_skill_dir
    ? resolve(expandHome(global_skill_dir))
    : join(homedir(), ".agents", "skills", "olt");
}

export function resolveSkillHomeRepo(currentRepoRoot?: string): string {
  const envVal = process.env["OLT_SKILL_HOME_REPO"]?.trim();
  if (envVal) {
    const exp = expandHome(envVal);
    if (existsSync(exp)) return resolve(exp);
  }
  const { skill_home } = readPolicyDefectConfig(currentRepoRoot);
  if (skill_home) return resolve(expandHome(skill_home));
  const cfg = loadSkillGlobalConfig();
  if (cfg && existsSync(cfg.home_repo_root)) return resolve(cfg.home_repo_root);
  const defaultSkillsRepo = "/Users/onurseckinsenoglu/repos/skills";
  if (existsSync(defaultSkillsRepo)) return resolve(defaultSkillsRepo);
  return findRepoRoot();
}
