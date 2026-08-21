import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SOURCE = join(process.cwd(), "orchestrating-long-tasks");
const TARGET = join(homedir(), ".agents", "skills", "orchestrating-long-tasks");

console.log(`[sync] Deploying ${SOURCE} -> ${TARGET}...`);

// Remove symlink or old directory cleanly
try {
  if (existsSync(TARGET) || lstatSync(TARGET).isSymbolicLink()) {
    rmSync(TARGET, { recursive: true, force: true });
  }
} catch {
  // Ignored if target does not exist
}

mkdirSync(TARGET, { recursive: true });

const ENTRIES = [
  "SKILL.md",
  ".skillignore",
  "agents",
  "checklists",
  "references",
  "roles",
  "scripts",
];

for (const entry of ENTRIES) {
  const srcPath = join(SOURCE, entry);
  const dstPath = join(TARGET, entry);
  if (existsSync(srcPath)) {
    cpSync(srcPath, dstPath, {
      recursive: true,
      filter: (src) => !src.includes(".capsules"),
    });
  }
}

// Clean up any stale nested .capsules if present in target
const nestedTargetCapsules = join(TARGET, "scripts", ".capsules");
if (existsSync(nestedTargetCapsules)) {
  rmSync(nestedTargetCapsules, { recursive: true, force: true });
}

console.log("✓ Global skill sync complete: ~/.agents/skills/orchestrating-long-tasks is up to date and isolated from working tree edits.");

