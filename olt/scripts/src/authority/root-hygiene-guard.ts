import { isAbsolute, relative } from "node:path";
import { HarnessError } from "../core/errors/index.ts";

const ALLOWED_ROOT_FILES: ReadonlySet<string> = new Set([
  "package.json",
  "tsconfig.json",
  "AGENTS.md",
  "README.md",
  "GEMINI.md",
  "lefthook.yml",
  ".gitignore",
  "bun.lock",
  "bun.lockb",
  ".editorconfig",
  ".oxfmtrc.json",
  "eslint.config.js",
  ".prettierrc",
  "LICENSE",
  "bunfig.toml",
  ".capture.yaml",
]);

const ALLOWED_ROOT_DIRS: ReadonlySet<string> = new Set([
  "olt",
  ".olt",
  "tests",
  "docs",
  "scratch",
  ".scratch",
  "coverage",
  ".coverage",
  "node_modules",
  ".git",
  ".github",
  ".tmp",
  ".locks",
  "scripts",
]);

export class RootDirectoryHygieneGuard {
  public static assertAllowedWritePath(repoRoot: string, targetPath: string): void {
    const absPath = isAbsolute(targetPath) ? targetPath : `${repoRoot}/${targetPath}`;
    const rel = relative(repoRoot, absPath);

    // If file is directly in root (no directory slashes)
    if (!rel.includes("/") && !rel.includes("\\")) {
      if (!ALLOWED_ROOT_FILES.has(rel)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[ROOT_HYGIENE_VIOLATION] Cannot create loose scratch file '${rel}' in repository root. All temporary scripts, patches, and logs MUST reside in 'scratch/' or '.olt/scratch/'.`,
        );
      }
      return;
    }

    const segments = rel.split(/[/\\]+/u).filter((s) => s.length > 0 && s !== ".");
    if (segments.length > 0) {
      const topDir = segments[0];
      if (!topDir) {
        return;
      }
      if (segments.length === 1 && ALLOWED_ROOT_FILES.has(topDir)) {
        return;
      }
      if (!ALLOWED_ROOT_DIRS.has(topDir)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[ROOT_HYGIENE_VIOLATION] Cannot create loose directory '${topDir}' in repository root. All temporary scripts, patches, and logs MUST reside in 'scratch/' or '.olt/scratch/', and capsule runs MUST reside in '.olt/capsules/'.`,
        );
      }
    }
  }
}
