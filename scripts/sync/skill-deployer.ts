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
import { guardedRemoveSync, logDestructiveOp, smartEnsureSymlink } from "./fs-helpers";
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

function assertIsSkillsRepoRoot(sourceRepoRoot: string): string {
  const resolved = resolve(sourceRepoRoot);
  const hasOlt = existsSync(join(resolved, "olt"));
  const hasGit = existsSync(join(resolved, ".git"));
  if (!hasOlt || !hasGit) {
    throw new Error(
      `refusing to sync from '${resolved}': it does not look like the skills repository ` +
        `(expected both 'olt/' and '.git' to exist here). Pass an explicit sourceRepoRoot ` +
        `pointing at the skills checkout.`,
    );
  }
  return resolved;
}

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
  const sourceRepoRoot = assertIsSkillsRepoRoot(orDefault(options?.sourceRepoRoot, process.cwd()));
  const home = orDefault(options?.homeDir, homedir());
  const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));
  const allowDirty = orDefault(options?.allowDirty, false);

  await migrateOwnedLegacyDeployment(targetOlt, sourceRepoRoot);

  const { sourceOltDir: sourceOlt, cleanup: cleanupSourceOlt } = resolveOltSyncSource(
    sourceRepoRoot,
    allowDirty,
  );

  try {
    await installSkill(sourceOlt, home, ["claude", "antigravity", "codex", "chatgpt"]);
  } finally {
    cleanupSourceOlt();
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

  const sourceNodeModules = join(sourceRepoRoot, "node_modules");
  if (existsSync(sourceNodeModules)) {
    smartEnsureSymlink(sourceNodeModules, join(targetOlt, "node_modules"), {
      allowedRoots: [targetOlt],
      onAudit: logDestructiveOp,
    });
  }

  guardedRemoveSync(join(home, ".agents", "skills", LEGACY_NAME), {
    allowedRoots: [join(home, ".agents", "skills")],
    missingOk: true,
    onAudit: logDestructiveOp,
  });

  const assistantSkillDirs = getAssistantSkillDirs(home);
  let syncedCount = 0;
  let skippedCount = 0;

  for (const dir of assistantSkillDirs) {
    try {
      mkdirSync(dir, { recursive: true });

      const legacyPath = join(dir, LEGACY_NAME);
      guardedRemoveSync(legacyPath, {
        allowedRoots: [dir],
        missingOk: true,
        onAudit: logDestructiveOp,
      });

      const oltPath = join(dir, "olt");
      const status = smartEnsureSymlink(targetOlt, oltPath, {
        allowedRoots: [dir],
        onAudit: logDestructiveOp,
      });
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
