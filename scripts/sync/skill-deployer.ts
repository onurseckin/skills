import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalJsonBytes } from "../../olt/scripts/src/core/json.ts";
import { installSkill } from "../../olt/scripts/src/installer/install.ts";
import {
  INSTALL_SCHEMA,
  INSTALL_VERSION,
  SKILL_NAME,
} from "../../olt/scripts/src/installer/constants.ts";
import { sealInstallationManifest } from "../../olt/scripts/src/installer/manifest-integrity.ts";
import { validateSkillSource } from "../../olt/scripts/src/installer/source-validation.ts";
import { identifiedInstallation } from "../../olt/scripts/src/installer/identity.ts";
import { safeCpSync } from "../../olt/scripts/src/core/shared/safe-fs/index.ts";
import { guardedRemoveSync, logDestructiveOp, smartEnsureSymlink } from "./fs-helpers.ts";
import { resolveSkillSyncSource } from "./git-source.ts";

export const SKILL_NAMES = ["olt", "chatroom"] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface DeploySkillOptions {
  sourceRepoRoot?: string | undefined;
  targetOltDir?: string | undefined;
  targetChatroomDir?: string | undefined;
  homeDir?: string | undefined;
  allowDirty?: boolean | undefined;
}

export interface DeploySkillResult {
  syncedCount: number;
  skippedCount: number;
  targetDir: string;
  assistantDirsCount: number;
  legacyHomePurged: boolean;
  transactions?: AssistantLinkTransaction[];
}

export interface AssistantLinkTransaction {
  readonly dir: string;
  readonly oltPath: string;
  readonly previousTarget: string | null;
  readonly existed: boolean;
  readonly status: "created" | "skipped";
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

export function rollbackAssistantLinks(
  transactions: readonly AssistantLinkTransaction[],
  allowedRoots: readonly string[] = [],
): void {
  for (const record of [...transactions].reverse()) {
    if (record.status !== "created") continue;
    try {
      if (record.existed && record.previousTarget !== null) {
        smartEnsureSymlink(record.previousTarget, record.oltPath, {
          allowedRoots: [record.dir, ...allowedRoots],
          allowGitRepositoryDeletion: true,
          onAudit: logDestructiveOp,
        });
      } else {
        guardedRemoveSync(record.oltPath, {
          allowedRoots: [record.dir, ...allowedRoots],
          missingOk: true,
          allowGitRepositoryDeletion: true,
          onAudit: logDestructiveOp,
        });
      }
    } catch (err) {
      console.warn(`[sync] Failed to rollback link at ${record.oltPath}:`, err);
    }
  }
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

export function readJsonStringField(filePath: string, field: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!value || typeof value !== "object") return undefined;
    const fieldValue = (value as Record<string, unknown>)[field];
    return typeof fieldValue === "string" ? fieldValue : undefined;
  } catch {
    return undefined;
  }
}

function isOwnedLegacyDeployment(targetOlt: string, sourceRepoRoot: string): boolean {
  const resolvedRoot = resolve(sourceRepoRoot);
  const homeRepoRoot = readJsonStringField(join(targetOlt, "skill-config.json"), "home_repo_root");
  if (homeRepoRoot && resolve(homeRepoRoot) === resolvedRoot) return true;
  const policyHomeRoot = readJsonStringField(
    join(targetOlt, "policy.json"),
    "skill_home_repo_root",
  );
  return Boolean(policyHomeRoot && resolve(policyHomeRoot) === resolvedRoot);
}

export async function migrateOwnedLegacyDeployment(
  targetOlt: string,
  sourceRepoRoot: string,
): Promise<boolean> {
  if (!existsSync(targetOlt)) return false;
  if (await identifiedInstallation(targetOlt)) return true;
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
  const manifestPath = join(targetOlt, "installation.json");
  if (existsSync(manifestPath)) {
    try {
      chmodSync(manifestPath, 0o644);
    } catch {}
  }
  writeFileSync(manifestPath, canonicalJsonBytes(manifest));
  return true;
}

export function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value !== undefined) {
    return value;
  }
  return fallback;
}

interface LinkAssistantSkillsResult {
  syncedCount: number;
  skippedCount: number;
  assistantDirsCount: number;
  transactions: AssistantLinkTransaction[];
}

function linkAssistantSkills(
  home: string,
  targetDir: string,
  skillName: string,
  legacyName?: string,
): LinkAssistantSkillsResult {
  const assistantSkillDirs = getAssistantSkillDirs(home);
  let syncedCount = 0;
  let skippedCount = 0;
  const transactions: AssistantLinkTransaction[] = [];

  try {
    for (const dir of assistantSkillDirs) {
      try {
        mkdirSync(dir, { recursive: true });

        if (legacyName !== undefined) {
          const legacyPath = join(dir, legacyName);
          guardedRemoveSync(legacyPath, {
            allowedRoots: [dir],
            missingOk: true,
            allowGitRepositoryDeletion: true,
            onAudit: logDestructiveOp,
          });
        }

        const skillPath = join(dir, skillName);
        let existed = false;
        let previousTarget: string | null = null;
        try {
          const st = lstatSync(skillPath);
          existed = true;
          if (st.isSymbolicLink()) {
            previousTarget = readlinkSync(skillPath);
          }
        } catch {}

        const status = smartEnsureSymlink(targetDir, skillPath, {
          allowedRoots: [dir],
          allowGitRepositoryDeletion: true,
          onAudit: logDestructiveOp,
        });

        transactions.push({
          dir,
          oltPath: skillPath,
          previousTarget,
          existed,
          status,
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
  } catch (error) {
    rollbackAssistantLinks(transactions, [home]);
    throw error;
  }

  return {
    syncedCount,
    skippedCount,
    assistantDirsCount: assistantSkillDirs.length,
    transactions,
  };
}

function writeSkillConfig(targetDir: string, sourceRepoRoot: string): void {
  const skillConfig = {
    home_repo_root: sourceRepoRoot,
    synced_at: new Date().toISOString(),
    version: "1.0.0",
  };
  writeFileSync(
    join(targetDir, "skill-config.json"),
    JSON.stringify(skillConfig, null, 2) + "\n",
    "utf-8",
  );
}

function linkSourceNodeModules(targetDir: string, sourceRepoRoot: string): void {
  const sourceNodeModules = join(sourceRepoRoot, "node_modules");
  if (existsSync(sourceNodeModules)) {
    smartEnsureSymlink(sourceNodeModules, join(targetDir, "node_modules"), {
      allowedRoots: [targetDir],
      allowGitRepositoryDeletion: true,
      onAudit: logDestructiveOp,
    });
  }
}

export async function deploySkill(
  skillName: string,
  options?: DeploySkillOptions,
): Promise<DeploySkillResult> {
  const sourceRepoRoot = assertIsSkillsRepoRoot(orDefault(options?.sourceRepoRoot, process.cwd()));
  const home = orDefault(options?.homeDir, homedir());
  const allowDirty = orDefault(options?.allowDirty, false);

  const { sourceSkillDir: sourceSkill, cleanup: cleanupSourceSkill } = resolveSkillSyncSource(
    sourceRepoRoot,
    skillName,
    allowDirty,
  );

  try {
    if (skillName === "olt") {
      const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));

      await migrateOwnedLegacyDeployment(targetOlt, sourceRepoRoot);
      await installSkill(sourceSkill, home, ["claude", "antigravity", "codex", "chatgpt"]);

      writeSkillConfig(targetOlt, sourceRepoRoot);
      linkSourceNodeModules(targetOlt, sourceRepoRoot);

      let legacyHomePurged = true;
      try {
        guardedRemoveSync(join(home, ".agents", "skills", LEGACY_NAME), {
          allowedRoots: [join(home, ".agents", "skills")],
          missingOk: true,
          allowGitRepositoryDeletion: true,
          onAudit: logDestructiveOp,
        });
      } catch (err) {
        legacyHomePurged = false;
        console.warn(
          `[sync] Left ${join(home, ".agents", "skills", LEGACY_NAME)} in place (best-effort legacy cleanup):`,
          err,
        );
      }

      const linkResult = linkAssistantSkills(home, targetOlt, "olt", LEGACY_NAME);

      return {
        syncedCount: linkResult.syncedCount,
        skippedCount: linkResult.skippedCount,
        targetDir: targetOlt,
        assistantDirsCount: linkResult.assistantDirsCount,
        legacyHomePurged,
        transactions: linkResult.transactions,
      };
    }

    const targetSkill = orDefault(
      skillName === "chatroom" ? options?.targetChatroomDir : undefined,
      join(home, ".agents", "skills", skillName),
    );

    mkdirSync(targetSkill, { recursive: true });

    if (existsSync(sourceSkill)) {
      safeCpSync(sourceSkill, targetSkill, {
        allowedRoots: [dirname(targetSkill)],
        allowOverwrite: true,
        onAudit: logDestructiveOp,
      });
    }

    writeSkillConfig(targetSkill, sourceRepoRoot);
    linkSourceNodeModules(targetSkill, sourceRepoRoot);

    const linkResult = linkAssistantSkills(home, targetSkill, skillName);

    return {
      syncedCount: linkResult.syncedCount,
      skippedCount: linkResult.skippedCount,
      targetDir: targetSkill,
      assistantDirsCount: linkResult.assistantDirsCount,
      legacyHomePurged: false,
      transactions: linkResult.transactions,
    };
  } finally {
    cleanupSourceSkill();
  }
}

export async function deployCanonicalSkill(
  options?: DeploySkillOptions,
): Promise<DeploySkillResult> {
  return deploySkill("olt", options);
}

export async function deployChatroomSkill(
  options?: DeploySkillOptions,
): Promise<DeploySkillResult> {
  return deploySkill("chatroom", options);
}
