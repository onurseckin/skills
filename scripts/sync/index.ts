import { homedir } from "node:os";
import { join } from "node:path";
import {
  deployCanonicalSkill,
  type DeploySkillOptions,
  type DeploySkillResult,
} from "./skill-deployer";
import {
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
} from "./olt-bin";
import {
  ensurePathInShellRc,
  type EnsureShellRcOptions,
  type EnsureShellRcResult,
} from "./shell-rc";

export interface SyncOptions extends DeploySkillOptions, EnsureBinaryOptions, EnsureShellRcOptions {
  silent?: boolean | undefined;
}

export interface SyncSummary {
  skill: DeploySkillResult;
  binary: EnsureBinaryResult;
  shell: EnsureShellRcResult;
}

export const GLOBAL_SYNC_GEN5 = true;

function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value !== undefined) {
    return value;
  }
  return fallback;
}

/**
 * Main orchestrator for synchronizing skills, deploying the global olt binary,
 * and configuring the shell environment.
 */
export async function runSync(options?: SyncOptions): Promise<SyncSummary> {
  const sourceRepoRoot = orDefault(options?.sourceRepoRoot, process.cwd());
  const home = orDefault(options?.homeDir, homedir());
  const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));
  const sourceOlt = join(sourceRepoRoot, "olt");

  if (!options?.silent) {
    console.log(`[sync] Deploying ${sourceOlt} -> ${targetOlt}...`);
  }

  // 1. Deploy canonical skill files and platform symlinks
  const skillResult = await deployCanonicalSkill(options);

  // 2. Ensure global olt executable binary
  const binaryResult = ensureGlobalOltBinary(options);

  // 3. Ensure ~/.local/bin is in active shell RC
  const shellResult = ensurePathInShellRc(options);

  if (!options?.silent) {
    console.log(
      `✓ Global skill sync complete: ~/.agents/skills/olt deployed. Ecosystem symlinks verified across ${skillResult.assistantDirsCount} assistant platforms (${skillResult.syncedCount} synced, ${skillResult.skippedCount} verified/skipped). Legacy 'orchestrating-long-tasks' purged.`,
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
}

// Auto-run if executed directly as entry script
function computeIsMain(): boolean {
  if (import.meta.main) {
    return true;
  }
  const entryArg = process.argv[1];
  if (entryArg === undefined) {
    return false;
  }
  if (entryArg.endsWith("scripts/sync/index.ts")) {
    return true;
  }
  return entryArg.endsWith("scripts/sync");
}

const isMain = computeIsMain();

if (isMain) {
  const allowDirty = process.argv.slice(2).includes("--allow-dirty");
  await runSync({ allowDirty });
}
