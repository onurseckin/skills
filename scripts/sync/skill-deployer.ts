import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { safeRemove, smartEnsureSymlink } from "./fs-helpers";

export interface DeploySkillOptions {
  sourceRepoRoot?: string | undefined;
  targetOltDir?: string | undefined;
  homeDir?: string | undefined;
}

export interface DeploySkillResult {
  syncedCount: number;
  skippedCount: number;
  targetDir: string;
  assistantDirsCount: number;
}

const LEGACY_NAME = "orchestrating-long-tasks";

const ENTRIES = [
  "SKILL.md",
  "AGENTS.md",
  ".skillignore",
  "agents",
  "checklists",
  "references",
  "roles",
  "scripts",
];

export function getAssistantSkillDirs(home: string): string[] {
  return [
    join(home, ".gemini", "config", "skills"),
    join(home, ".gemini", "antigravity-cli", "skills"),
    join(home, ".gemini", "antigravity-ide", "skills"),
    join(home, ".gemini", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".cursor", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".codex", "vendor_imports", "skills"),
    join(home, ".openai", "skills"),
  ];
}

/**
 * Deploys the canonical olt/ directory to ~/.agents/skills/olt and
 * establishes symlinks across the 9 ecosystem assistant platforms.
 */
export function deployCanonicalSkill(options?: DeploySkillOptions): DeploySkillResult {
  const sourceRepoRoot = options?.sourceRepoRoot ?? process.cwd();
  const home = options?.homeDir ?? homedir();
  const targetOlt = options?.targetOltDir ?? join(home, ".agents", "skills", "olt");
  const sourceOlt = join(sourceRepoRoot, "olt");

  // 1. Deploy primary canonical skill to ~/.agents/skills/olt
  safeRemove(targetOlt);
  mkdirSync(targetOlt, { recursive: true });

  for (const entry of ENTRIES) {
    const srcPath = join(sourceOlt, entry);
    const dstPath = join(targetOlt, entry);
    if (existsSync(srcPath)) {
      cpSync(srcPath, dstPath, {
        recursive: true,
        filter: (src) => !src.includes(".capsules") && !src.includes("capsules"),
      });
    }
  }

  const skillConfig = {
    home_repo_root: sourceRepoRoot,
    synced_at: new Date().toISOString(),
    version: "1.0.0",
  };
  writeFileSync(
    join(targetOlt, "skill-config.json"),
    JSON.stringify(skillConfig, null, 2) + "\n",
    "utf-8",
  );

  // 2. Symlink node_modules if present in source repo for module resolution
  const srcNodeModules = join(sourceRepoRoot, "node_modules");
  if (existsSync(srcNodeModules)) {
    smartEnsureSymlink(srcNodeModules, join(targetOlt, "node_modules"));
  }

  // 3. Remove legacy name in ~/.agents/skills/
  safeRemove(join(home, ".agents", "skills", LEGACY_NAME));

  // 4. Application Skill Directories across ecosystem platforms
  const assistantSkillDirs = getAssistantSkillDirs(home);
  let syncedCount = 0;
  let skippedCount = 0;

  for (const dir of assistantSkillDirs) {
    try {
      mkdirSync(dir, { recursive: true });

      // Always purge obsolete legacy name from app directories
      const legacyPath = join(dir, LEGACY_NAME);
      safeRemove(legacyPath);

      // Smart symlink for olt
      const oltPath = join(dir, "olt");
      const status = smartEnsureSymlink(targetOlt, oltPath);
      if (status === "created") {
        syncedCount++;
      } else {
        skippedCount++;
      }
    } catch (err) {
      console.warn(`[sync] Could not process ${dir}:`, err);
    }
  }

  return {
    syncedCount,
    skippedCount,
    targetDir: targetOlt,
    assistantDirsCount: assistantSkillDirs.length,
  };
}
