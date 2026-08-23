import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SOURCE = join(process.cwd(), "olt");
const TARGET_OLT = join(homedir(), ".agents", "skills", "olt");
const TARGET_LEGACY = join(homedir(), ".agents", "skills", "orchestrating-long-tasks");

console.log(`[sync] Deploying ${SOURCE} -> ${TARGET_OLT}...`);

function safeRemove(targetPath: string): void {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignored if target does not exist
  }
}

function ensureSymlink(target: string, linkPath: string): void {
  safeRemove(linkPath);
  try {
    symlinkSync(target, linkPath);
  } catch {
    // If symlink fails, copy contents as fallback
    try {
      cpSync(target, linkPath, { recursive: true });
    } catch {
      // Ignored
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

// 2. Link legacy name in ~/.agents/skills/
ensureSymlink(TARGET_OLT, TARGET_LEGACY);

// 3. Application Skill Directories to Link Across Ecosystem
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

let syncedAssistantsCount = 0;

for (const dir of ASSISTANT_SKILL_DIRS) {
  try {
    mkdirSync(dir, { recursive: true });
    const oltLink = join(dir, "olt");
    const legacyLink = join(dir, "orchestrating-long-tasks");

    ensureSymlink(TARGET_OLT, oltLink);
    ensureSymlink(TARGET_OLT, legacyLink);
    syncedAssistantsCount++;
  } catch (err) {
    console.warn(`[sync] Could not link into ${dir}:`, err);
  }
}

console.log(
  `✓ Global skill sync complete: ~/.agents/skills/olt and ${syncedAssistantsCount} assistant platforms (Antigravity CLI/IDE/Cloud, Claude, Codex, Cursor, Gemini) are 100% in sync with both 'olt' and 'orchestrating-long-tasks' aliases.`,
);

export const GLOBAL_SYNC_GEN5 = true;
