import { isAbsolute, relative, dirname } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

const ALLOWED_ROOT_FILES = new Set([
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
    }
  }
}
