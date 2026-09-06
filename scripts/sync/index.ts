import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  deployCanonicalSkill,
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  readJsonStringField,
  rollbackAssistantLinks,
  type AssistantLinkTransaction,
  type DeploySkillOptions,
  type DeploySkillResult,
} from "./skill-deployer.ts";
import {
  buildOltBinaryContent,
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
} from "./olt-bin.ts";
import {
  detectShellRcPath,
  ensurePathInShellRc,
  generateExportLine,
  isPathDeclaredInContent,
  type EnsureShellRcOptions,
  type EnsureShellRcResult,
} from "./shell-rc.ts";
import {
  areSignalHooksRegistered,
  decideSyncSource,
  firstNonEmpty,
  getActiveCleanupsCount,
  getDirtyOltPaths,
  materializeOltFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
  type ResolvedOltSource,
  type SyncSourceDecision,
} from "./git-source.ts";
import {
  FALLBACK_MARKER,
  guardedRemoveSync,
  isManagedFallbackCopy,
  logDestructiveOp,
  smartEnsureSymlink,
  type FsDriver,
  type GuardedRemoveOptions,
  type SmartEnsureSymlinkOptions,
} from "./fs-helpers.ts";

export {
  deployCanonicalSkill,
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  readJsonStringField,
  rollbackAssistantLinks,
  type AssistantLinkTransaction,
  type DeploySkillOptions,
  type DeploySkillResult,
};

export {
  buildOltBinaryContent,
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
};

export {
  detectShellRcPath,
  ensurePathInShellRc,
  generateExportLine,
  isPathDeclaredInContent,
  type EnsureShellRcOptions,
  type EnsureShellRcResult,
};

export {
  areSignalHooksRegistered,
  decideSyncSource,
  firstNonEmpty,
  getActiveCleanupsCount,
  getDirtyOltPaths,
  materializeOltFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveOltSyncSource,
  type ResolvedOltSource,
  type SyncSourceDecision,
};

export {
  FALLBACK_MARKER,
  guardedRemoveSync,
  isManagedFallbackCopy,
  logDestructiveOp,
  smartEnsureSymlink,
  type FsDriver,
  type GuardedRemoveOptions,
  type SmartEnsureSymlinkOptions,
};

export interface SyncOptions extends DeploySkillOptions, EnsureBinaryOptions, EnsureShellRcOptions {
  silent?: boolean | undefined;
}

export interface SyncSummary {
  skill: DeploySkillResult;
  binary: EnsureBinaryResult;
  shell: EnsureShellRcResult;
}

export const GLOBAL_SYNC_GEN5 = true;

export function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value !== undefined) {
    return value;
  }
  return fallback;
}

export function ensureDefectRoutingDeployment(targetOlt: string, sourceRepoRoot: string): void {
  try {
    const targetDotOlt = join(targetOlt, ".olt");
    if (!existsSync(targetDotOlt)) {
      mkdirSync(targetDotOlt, { recursive: true });
    }
    const configPath = join(targetOlt, "skill-config.json");
    let currentConfig: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        currentConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      } catch {}
    }
    const updatedConfig = {
      ...currentConfig,
      home_repo_root: sourceRepoRoot,
      defect_routing: {
        skill_home_repo_root: sourceRepoRoot,
        global_skill_dir: targetOlt,
        dual_write_enabled: true,
      },
    };
    writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + "\n", "utf-8");
  } catch {}
}

export async function runSync(options?: SyncOptions): Promise<SyncSummary> {
  const sourceRepoRoot = orDefault(options?.sourceRepoRoot, process.cwd());
  const home = orDefault(options?.homeDir, process.env.HOME || homedir());
  const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));
  const sourceOlt = join(sourceRepoRoot, "olt");

  if (!options?.silent) {
    console.log(`[sync] Deploying ${sourceOlt} -> ${targetOlt}...`);
  }

  let skillResult: DeploySkillResult | undefined;
  try {
    skillResult = await deployCanonicalSkill({ ...options, homeDir: home });
    ensureDefectRoutingDeployment(targetOlt, sourceRepoRoot);
    const binaryResult = ensureGlobalOltBinary({ ...options, homeDir: home });
    const shellResult = ensurePathInShellRc({ ...options, homeDir: home });

    if (!options?.silent) {
      console.log(
        `✓ Global skill sync complete: ~/.agents/skills/olt deployed. Ecosystem symlinks verified across ${skillResult.assistantDirsCount} assistant platforms (${skillResult.syncedCount} synced, ${skillResult.skippedCount} verified/skipped). Legacy 'orchestrating-long-tasks' ${skillResult.legacyHomePurged ? "purged" : "left in place (see warning above)"}.`,
      );
      console.log(`✓ Global binary: ${binaryResult.binaryPath} (${binaryResult.status}).`);
      if (shellResult.modified) {
        console.log(`✓ Shell PATH: Configured in ${shellResult.targetRc}.`);
      } else {
        console.log(
          `✓ Shell PATH: ${shellResult.reason} (${orDefault(shellResult.targetRc, "N/A")}).`,
        );
      }
    }

    return {
      skill: skillResult,
      binary: binaryResult,
      shell: shellResult,
    };
  } catch (error) {
    if (skillResult?.transactions) {
      rollbackAssistantLinks(skillResult.transactions, [home]);
    }
    throw error;
  }
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  if (entryArg.endsWith("scripts/sync/index.ts")) return true;
  if (entryArg.endsWith("scripts/sync")) return true;
  return false;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  options?: Partial<SyncOptions>,
): Promise<void> {
  const allowDirty = argv.includes("--allow-dirty") || (options?.allowDirty ?? false);
  await runSync({ ...options, allowDirty });
}

if (computeIsMain()) {
  await main();
}
