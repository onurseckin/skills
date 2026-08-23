import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SOURCE = join(process.cwd(), "olt");
const TARGET_OLT = join(homedir(), ".agents", "skills", "olt");
const LEGACY_NAME = "orchestrating-long-tasks";

console.log(`[sync] Deploying ${SOURCE} -> ${TARGET_OLT}...`);

function safeRemove(targetPath: string): void {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignored if target does not exist
  }
}

function smartEnsureSymlink(target: string, linkPath: string): "skipped" | "created" {
  try {
    const lstat = lstatSync(linkPath);
    if (lstat.isSymbolicLink()) {
      try {
        const currentTarget = readlinkSync(linkPath);
        if (currentTarget === target) {
          return "skipped";
        }
      } catch {
        // Fall through to recreate
      }
    }
  } catch {
    // Does not exist, will create
  }

  safeRemove(linkPath);
  try {
    symlinkSync(target, linkPath);
    return "created";
  } catch {
    // If symlink fails, copy contents as fallback
    try {
      cpSync(target, linkPath, { recursive: true });
      return "created";
    } catch {
      return "skipped";
    }
  }
}

// 1. Deploy primary canonical skill to ~/.agents/skills/olt
safeRemove(TARGET_OLT);
mkdirSync(TARGET_OLT, { recursive: true });

const ENTRIES = [
  "SKILL.md",
  "AGENTS.md",
  ".skillignore",
  "agents",
  "checklists",
  "mind",
  "references",
  "roles",
  "scripts",
];

for (const entry of ENTRIES) {
  const srcPath = join(SOURCE, entry);
  const dstPath = join(TARGET_OLT, entry);
  if (existsSync(srcPath)) {
    cpSync(srcPath, dstPath, {
      recursive: true,
      filter: (src) => !src.includes(".capsules") && !src.includes("capsules"),
    });
  }
}

// 2. Remove legacy name in ~/.agents/skills/
safeRemove(join(homedir(), ".agents", "skills", LEGACY_NAME));

// 3. Application Skill Directories across ecosystem
const ASSISTANT_SKILL_DIRS = [
  join(homedir(), ".gemini", "config", "skills"), // Antigravity Cloud / Gemini Config
  join(homedir(), ".gemini", "antigravity-cli", "skills"), // Antigravity CLI
  join(homedir(), ".gemini", "antigravity-ide", "skills"), // Antigravity IDE
  join(homedir(), ".gemini", "skills"), // Gemini Global Skills
  join(homedir(), ".claude", "skills"), // Claude Code
  join(homedir(), ".cursor", "skills"), // Cursor IDE
  join(homedir(), ".codex", "skills"), // Codex
  join(homedir(), ".codex", "vendor_imports", "skills"), // Codex Vendor Imports
  join(homedir(), ".openai", "skills"), // OpenAI / ChatGPT
];

let createdCount = 0;
let skippedCount = 0;

for (const dir of ASSISTANT_SKILL_DIRS) {
  try {
    mkdirSync(dir, { recursive: true });

    // Always purge obsolete legacy name from app directories
    const legacyPath = join(dir, LEGACY_NAME);
    safeRemove(legacyPath);

    // Smart symlink for olt
    const oltPath = join(dir, "olt");
    const status = smartEnsureSymlink(TARGET_OLT, oltPath);
    if (status === "created") {
      createdCount++;
    } else {
      skippedCount++;
    }
  } catch (err) {
    console.warn(`[sync] Could not process ${dir}:`, err);
  }
}

console.log(
  `✓ Global skill sync complete: ~/.agents/skills/olt deployed. Ecosystem symlinks verified across ${ASSISTANT_SKILL_DIRS.length} assistant platforms (${createdCount} synced, ${skippedCount} verified/skipped). Legacy '${LEGACY_NAME}' purged.`,
);

export const GLOBAL_SYNC_GEN5 = true;
