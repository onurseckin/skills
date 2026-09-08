import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  deployCanonicalSkill,
  deployChatroomSkill,
  deploySkill,
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  readJsonStringField,
  rollbackAssistantLinks,
  SKILL_NAMES,
  type AssistantLinkTransaction,
  type DeploySkillOptions,
  type DeploySkillResult,
  type SkillName,
} from "./skill-deployer.ts";
import {
  buildOltBinaryContent,
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
} from "./olt-bin.ts";
import {
  buildChatBinaryContent,
  buildChatroomBinaryContent,
  ensureGlobalChatBinary,
  ensureGlobalChatroomBinary,
} from "./chatroom-bin.ts";
import { resolveDefaultMirrorDir, resolveSourceDir, SKILL_REGISTRY } from "./skill-registry.ts";
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
  getDirtySkillPaths,
  materializeSkillFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveSkillSyncSource,
  type ResolvedSkillSource,
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
import {
  assertInsideMirrorRoot,
  collectStalePaths,
  formatPruneReport,
  isPreservedEntry,
  pruneMirror,
  PRESERVED_MIRROR_ENTRIES,
  type PruneMirrorOptions,
  type PruneMirrorResult,
} from "./prune.ts";

export {
  deployCanonicalSkill,
  deployChatroomSkill,
  deploySkill,
  getAssistantSkillDirs,
  migrateOwnedLegacyDeployment,
  readJsonStringField,
  rollbackAssistantLinks,
  SKILL_NAMES,
  type AssistantLinkTransaction,
  type DeploySkillOptions,
  type DeploySkillResult,
  type SkillName,
};

export {
  buildOltBinaryContent,
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
};

export {
  buildChatBinaryContent,
  buildChatroomBinaryContent,
  ensureGlobalChatBinary,
  ensureGlobalChatroomBinary,
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
  getDirtySkillPaths,
  materializeSkillFromHead,
  parsePorcelainStatus,
  refuseSyncSourceMessage,
  resolveSkillSyncSource,
  type ResolvedSkillSource,
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

export {
  assertInsideMirrorRoot,
  collectStalePaths,
  formatPruneReport,
  isPreservedEntry,
  pruneMirror,
  PRESERVED_MIRROR_ENTRIES,
  type PruneMirrorOptions,
  type PruneMirrorResult,
};

export interface SyncOptions extends DeploySkillOptions, EnsureBinaryOptions, EnsureShellRcOptions {
  silent?: boolean | undefined;
  prune?: boolean | undefined;
}

export interface SyncSummary {
  skill: DeploySkillResult;
  binary: EnsureBinaryResult;
  shell: EnsureShellRcResult;
  skills?: Record<string, DeploySkillResult> | undefined;
  binaries?: Record<string, EnsureBinaryResult> | undefined;
  prune?: Record<string, PruneMirrorResult> | undefined;
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

export interface MirrorPruneTarget {
  readonly skillName: string;
  readonly sourceDir: string;
  readonly mirrorDir: string;
}

export function pruneDeployedMirrors(
  targets: readonly MirrorPruneTarget[],
  apply: boolean,
): Record<string, PruneMirrorResult> {
  const results: Record<string, PruneMirrorResult> = {};
  for (const target of targets) {
    results[target.skillName] = pruneMirror({
      sourceDir: target.sourceDir,
      mirrorDir: target.mirrorDir,
      mirrorRoot: target.mirrorDir,
      apply,
      onAudit: logDestructiveOp,
    });
  }
  return results;
}

export function resolveEffectiveHome(requestedHome?: string): string {
  const raw = orDefault(requestedHome, process.env.HOME || homedir());
  try {
    const agentsLink = join(raw, ".agents");
    if (existsSync(agentsLink) && lstatSync(agentsLink).isSymbolicLink()) {
      return dirname(realpathSync(agentsLink));
    }
  } catch {}
  return raw;
}

export async function runSync(options?: SyncOptions): Promise<SyncSummary> {
  const sourceRepoRoot = orDefault(options?.sourceRepoRoot, process.cwd());
  const home = resolveEffectiveHome(options?.homeDir);
  const targetOlt = orDefault(options?.targetOltDir, resolveDefaultMirrorDir(home, "olt"));
  const targetChatroom = orDefault(
    options?.targetChatroomDir,
    resolveDefaultMirrorDir(home, "chatroom"),
  );
  const targetOverridesByName: Readonly<Record<string, string>> = {
    olt: targetOlt,
    chatroom: targetChatroom,
  };
  const resolveTargetDir = (name: string): string =>
    orDefault(targetOverridesByName[name], resolveDefaultMirrorDir(home, name));

  if (!options?.silent) {
    for (const definition of SKILL_REGISTRY) {
      console.log(
        `[sync] Deploying ${resolveSourceDir(sourceRepoRoot, definition)} -> ${resolveTargetDir(definition.name)}...`,
      );
    }
  }

  const skillResults: Record<string, DeploySkillResult> = {};
  const allTransactions: AssistantLinkTransaction[] = [];
  try {
    for (const definition of SKILL_REGISTRY) {
      const res = await deploySkill(definition.name, { ...options, homeDir: home });
      skillResults[definition.name] = res;
      if (res.transactions) {
        allTransactions.push(...res.transactions);
      }
    }
    ensureDefectRoutingDeployment(targetOlt, sourceRepoRoot);

    const pruneTargets: MirrorPruneTarget[] = SKILL_REGISTRY.map((definition) => ({
      skillName: definition.name,
      sourceDir: resolveSourceDir(sourceRepoRoot, definition),
      mirrorDir: resolveTargetDir(definition.name),
    }));
    const pruneResults = pruneDeployedMirrors(pruneTargets, options?.prune === true);
    if (!options?.silent) {
      console.log(formatPruneReport(Object.values(pruneResults)));
    }

    const binaryResults: Record<string, EnsureBinaryResult> = {};
    for (const definition of SKILL_REGISTRY) {
      for (const [binaryName, ensureBinary] of Object.entries(definition.ensureBinaries)) {
        binaryResults[binaryName] = ensureBinary({ ...options, homeDir: home });
      }
    }
    const shellResult = ensurePathInShellRc({ ...options, homeDir: home });

    const oltResult = skillResults["olt"];
    if (!oltResult) {
      throw new Error("OLT skill deployment failed");
    }
    const oltBinaryResult = binaryResults["olt"];
    if (!oltBinaryResult) {
      throw new Error("OLT binary deployment failed");
    }

    if (!options?.silent) {
      console.log(
        `✓ Global skill sync complete: ~/.agents/skills/olt deployed. Ecosystem symlinks verified across ${oltResult.assistantDirsCount} assistant platforms (${oltResult.syncedCount} synced, ${oltResult.skippedCount} verified/skipped). Legacy 'orchestrating-long-tasks' ${oltResult.legacyHomePurged ? "purged" : "left in place (see warning above)"}.`,
      );
      for (const definition of SKILL_REGISTRY) {
        if (definition.name === "olt") continue;
        const result = skillResults[definition.name];
        if (!result) continue;
        console.log(
          `✓ Global skill sync complete: ~/.agents/skills/${definition.name} deployed. Ecosystem symlinks verified across ${result.assistantDirsCount} assistant platforms (${result.syncedCount} synced, ${result.skippedCount} verified/skipped).`,
        );
      }
      for (const binaryResult of Object.values(binaryResults)) {
        console.log(`✓ Global binary: ${binaryResult.binaryPath} (${binaryResult.status}).`);
      }
      if (shellResult.modified) {
        console.log(`✓ Shell PATH: Configured in ${shellResult.targetRc}.`);
      } else {
        console.log(
          `✓ Shell PATH: ${shellResult.reason} (${orDefault(shellResult.targetRc, "N/A")}).`,
        );
      }
    }

    return {
      skill: oltResult,
      binary: oltBinaryResult,
      shell: shellResult,
      skills: skillResults,
      binaries: binaryResults,
      prune: pruneResults,
    };
  } catch (error) {
    if (allTransactions.length > 0) {
      rollbackAssistantLinks(allTransactions, [home]);
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
  const prune = argv.includes("--prune") || (options?.prune ?? false);
  await runSync({ ...options, allowDirty, prune });
}

if (computeIsMain()) {
  await main();
}
