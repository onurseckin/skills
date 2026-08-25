import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJsonBytes } from "../../olt/scripts/src/core/json.ts";
import { installSkill } from "../../olt/scripts/src/installer/install.ts";
import {
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../olt/scripts/src/installer/constants.ts";
import { sealInstallationManifest } from "../../olt/scripts/src/installer/manifest-integrity.ts";
import { validateSkillSource } from "../../olt/scripts/src/installer/source-validation.ts";
import { safeRemove, smartEnsureSymlink } from "./fs-helpers";
import { resolveOltSyncSource } from "./git-source";

export interface DeploySkillOptions {
  sourceRepoRoot?: string | undefined;
  targetOltDir?: string | undefined;
  homeDir?: string | undefined;
  allowDirty?: boolean | undefined;
}

export interface DeploySkillResult {
  syncedCount: number;
  skippedCount: number;
  targetDir: string;
  assistantDirsCount: number;
}

const LEGACY_NAME = "orchestrating-long-tasks";

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
function isOwnedLegacyDeployment(targetOlt: string, sourceRepoRoot: string): boolean {
  const legacyConfigPath = join(targetOlt, "skill-config.json");
  if (!existsSync(legacyConfigPath)) return false;
  try {
    const value = JSON.parse(readFileSync(legacyConfigPath, "utf-8")) as unknown;
    if (!value) return false;
    if (typeof value !== "object") return false;
    const homeRepoRoot = (value as Record<string, unknown>)["home_repo_root"];
    return typeof homeRepoRoot === "string" && resolve(homeRepoRoot) === resolve(sourceRepoRoot);
  } catch {
    return false;
  }
}

/**
 * Give a verified pre-manifest deployment an identity before the hardened installer publishes a
 * replacement. This keeps the old release available until the installer's atomic swap commits.
 */
export async function migrateOwnedLegacyDeployment(
  targetOlt: string,
  sourceRepoRoot: string,
): Promise<boolean> {
  if (!existsSync(targetOlt)) return false;
  if (existsSync(join(targetOlt, "installation.json"))) return false;
  if (!isOwnedLegacyDeployment(targetOlt, sourceRepoRoot)) {
    throw new Error(
      `refusing to replace untrusted global skill directory without installation.json: ${targetOlt}`,
    );
  }
  const legacy = await validateSkillSource(targetOlt);
  const manifest = sealInstallationManifest({
    schema: INSTALL_SCHEMA,
    version: INSTALL_VERSION,
    skill_name: SKILL_NAME,
    runtime_version: legacy.runtimeVersion,
    source_sha256: legacy.digest,
    installed_at: new Date().toISOString(),
    clients: ["antigravity", "chatgpt", "claude", "codex"],
  });
  writeFileSync(join(targetOlt, "installation.json"), canonicalJsonBytes(manifest));
  return true;
}

function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value !== undefined) {
    return value;
  }
  return fallback;
}

export async function deployCanonicalSkill(
  options?: DeploySkillOptions,
): Promise<DeploySkillResult> {
  const sourceRepoRoot = orDefault(options?.sourceRepoRoot, process.cwd());
  const home = orDefault(options?.homeDir, homedir());
  const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));
  const allowDirty = orDefault(options?.allowDirty, false);

  // The pre-manifest deployer wrote skill-config.json but could not produce the signed release
  // manifest required by `doctor --source --home`. Migrate only a deployment that proves it was
  // made from this exact source repository; its identity lets installSkill atomically replace it.
  await migrateOwnedLegacyDeployment(targetOlt, sourceRepoRoot);

  // Resolves to the committed olt/ tree unless --allow-dirty explicitly opts into deploying the
  // working tree as-is; refuses outright when olt/ is dirty and no override was given.
  const { sourceOltDir: sourceOlt, cleanup: cleanupSourceOlt } = resolveOltSyncSource(
    sourceRepoRoot,
    allowDirty,
  );

  try {
    // Publish through the hardened installer so the deployed tree and its installation manifest
    // have a single digest contract with doctor.
    await installSkill(sourceOlt, home, ["claude", "antigravity", "codex", "chatgpt"]);
  } finally {
    cleanupSourceOlt();
  }

  // Preserve the runtime's source-home lookup while installation verification intentionally
  // excludes this deploy-local metadata file from the release digest.
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

  // OLT's runtime package resolves its dependencies relative to the deployed skill. Keep the
  // same source-owned dependency link that previous deployments used; installer verification
  // deliberately excludes it because it is host-local runtime plumbing, not release content.
  const sourceNodeModules = join(sourceRepoRoot, "node_modules");
  if (existsSync(sourceNodeModules)) {
    smartEnsureSymlink(sourceNodeModules, join(targetOlt, "node_modules"));
  }

  // Remove legacy name in ~/.agents/skills/
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
