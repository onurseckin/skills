import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { findRepoRoot, OLT_DIR_NAME, OLT_FILES } from "./repo-root.ts";

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
  if (repoRoot?.trim()) {
    roots.push(resolve(repoRoot.trim()));
  } else {
    try {
      roots.push(findRepoRoot());
    } catch {}
  }

  let skill_home: string | undefined;
  let global_skill_dir: string | undefined;

  for (const root of roots) {
    for (const sub of [join(OLT_DIR_NAME, OLT_FILES.POLICY), OLT_FILES.POLICY]) {
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

const SKILL_HOME_PACKAGE_NAME = "@onurseckin/skills";
const SKILL_HOME_MARKER_RELATIVE_PATH = join("olt", "scripts", "harness.ts");

function readOwnPackageName(root: string): string | undefined {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const name = (parsed as Record<string, unknown>)["name"];
      if (typeof name === "string") return name;
    }
  } catch {}
  return undefined;
}

function readOwnPolicySkillHomeRoot(root: string): string | undefined {
  const policyPath = join(root, OLT_DIR_NAME, OLT_FILES.POLICY);
  if (!existsSync(policyPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(policyPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const rec = parsed as Record<string, unknown>;
    const dr = rec["defect_routing"] as Record<string, unknown> | undefined;
    const fromDefectRouting = dr && typeof dr === "object" ? dr["skill_home_repo_root"] : undefined;
    const raw =
      typeof fromDefectRouting === "string" ? fromDefectRouting : rec["skill_home_repo_root"];
    if (typeof raw === "string" && raw.trim()) return resolve(expandHome(raw.trim()));
  } catch {}
  return undefined;
}

export function isSkillHomeRepoRoot(root: string): boolean {
  if (typeof root !== "string" || root.length === 0) return false;
  const resolvedRoot = resolve(root);
  if (existsSync(join(resolvedRoot, SKILL_HOME_MARKER_RELATIVE_PATH))) return true;
  if (readOwnPackageName(resolvedRoot) === SKILL_HOME_PACKAGE_NAME) return true;
  return readOwnPolicySkillHomeRoot(resolvedRoot) === resolvedRoot;
}

export function resolveSkillHomeRepo(currentRepoRoot?: string): string {
  const envVal = process.env["OLT_SKILL_HOME_REPO"]?.trim();
  if (envVal && existsSync(expandHome(envVal))) return resolve(expandHome(envVal));
  if (currentRepoRoot?.trim()) {
    const { skill_home } = readPolicyDefectConfig(currentRepoRoot);
    if (skill_home) return resolve(expandHome(skill_home));
  }
  const cfg = loadSkillGlobalConfig();
  if (cfg && existsSync(cfg.home_repo_root)) return resolve(cfg.home_repo_root);
  const { skill_home } = readPolicyDefectConfig();
  if (skill_home) return resolve(expandHome(skill_home));
  const defaultSkillsRepo = "/Users/onurseckinsenoglu/repos/skills";
  if (existsSync(defaultSkillsRepo)) return resolve(defaultSkillsRepo);
  return findRepoRoot();
}
