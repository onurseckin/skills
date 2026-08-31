import { homedir } from "node:os";
import { join } from "node:path";
import {
  deployCanonicalSkill,
  type DeploySkillOptions,
  type DeploySkillResult,
} from "./skill-deployer.ts";
import {
  ensureGlobalOltBinary,
  type EnsureBinaryOptions,
  type EnsureBinaryResult,
} from "./olt-bin.ts";
import {
  ensurePathInShellRc,
  type EnsureShellRcOptions,
  type EnsureShellRcResult,
} from "./shell-rc.ts";

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

export async function runSync(options?: SyncOptions): Promise<SyncSummary> {
  const sourceRepoRoot = orDefault(options?.sourceRepoRoot, process.cwd());
  const home = orDefault(options?.homeDir, homedir());
  const targetOlt = orDefault(options?.targetOltDir, join(home, ".agents", "skills", "olt"));
  const sourceOlt = join(sourceRepoRoot, "olt");

  if (!options?.silent) {
    console.log(`[sync] Deploying ${sourceOlt} -> ${targetOlt}...`);
  }

  const skillResult = await deployCanonicalSkill(options);

  const binaryResult = ensureGlobalOltBinary(options);

  const shellResult = ensurePathInShellRc(options);

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
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return entryArg.endsWith("scripts/sync/index.ts") || entryArg.endsWith("scripts/sync");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const allowDirty = argv.includes("--allow-dirty");
  await runSync({ allowDirty });
}

if (computeIsMain()) {
  await main();
}
