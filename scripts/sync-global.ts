import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SOURCE = join(process.cwd(), "olt");
const TARGET_OLT = join(homedir(), ".agents", "skills", "olt");
const TARGET_LEGACY = join(homedir(), ".agents", "skills", "olt");

console.log(`[sync] Deploying ${SOURCE} -> ${TARGET_OLT}...`);

function safeRemove(targetPath: string): void {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignored if target does not exist
  }
}

// Deploy to ~/.agents/skills/olt
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

// Also deploy / link legacy target for backward compatibility
safeRemove(TARGET_LEGACY);
try {
  symlinkSync(TARGET_OLT, TARGET_LEGACY);
} catch {
  try {
    cpSync(TARGET_OLT, TARGET_LEGACY, { recursive: true });
  } catch {
    // Ignored
  }
}

// Maintain Antigravity Cloud / Gemini Config symlinks
const GEMINI_SKILLS_DIR = join(homedir(), ".gemini", "config", "skills");
if (existsSync(GEMINI_SKILLS_DIR)) {
  const geminiOlt = join(GEMINI_SKILLS_DIR, "olt");
  const geminiLegacy = join(GEMINI_SKILLS_DIR, "olt");

  safeRemove(geminiOlt);
  try {
    symlinkSync(TARGET_OLT, geminiOlt);
  } catch {
    // Ignored
  }

  safeRemove(geminiLegacy);
  try {
    symlinkSync(TARGET_OLT, geminiLegacy);
  } catch {
    // Ignored
  }
}

console.log(
  "✓ Global skill sync complete: ~/.agents/skills/olt and Antigravity cloud symlinks are up to date.",
);

export const GLOBAL_SYNC_GEN5 = true;
