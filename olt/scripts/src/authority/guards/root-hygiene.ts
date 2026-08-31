import { isAbsolute, relative } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES } from "./constants.ts";

export class RootDirectoryHygieneGuard {
  public constructor() {}

  public static assertAllowedWritePath(repoRoot: string, targetPath: string): void {
    const absPath = isAbsolute(targetPath) ? targetPath : `${repoRoot}/${targetPath}`;
    const rel = relative(repoRoot, absPath);

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
      if (!topDir) return;
      if (segments.length === 1 && ALLOWED_ROOT_FILES.has(topDir)) return;
      if (!ALLOWED_ROOT_DIRS.has(topDir)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `[ROOT_HYGIENE_VIOLATION] Cannot create loose directory '${topDir}' in repository root. All temporary scripts, patches, and logs MUST reside in 'scratch/' or '.olt/scratch/', and capsule runs MUST reside in '.olt/capsules/'.`,
        );
      }

      if (topDir === "olt" && !segments.includes("references")) {
        const lastSegment = segments[segments.length - 1];
        const fileName = typeof lastSegment === "string" ? lastSegment : "";
        const forbiddenSuffixes = [".jsonl", ".log"];
        const forbiddenSegments = ["coverage", "quarantine", ".coverage"];
        const isRuntimeFile = forbiddenSuffixes.some((suffix) => fileName.endsWith(suffix));
        const isRuntimeDir = forbiddenSegments.some((dir) => segments.includes(dir));
        if (isRuntimeFile) {
          throw new HarnessError(
            "PATH_SAFETY",
            `[ROOT_HYGIENE_VIOLATION] Cannot write runtime file or directory '${rel}' inside static package directory 'olt/'. All runtime state must live in '.olt/'.`,
          );
        }
        if (isRuntimeDir) {
          throw new HarnessError(
            "PATH_SAFETY",
            `[ROOT_HYGIENE_VIOLATION] Cannot write runtime file or directory '${rel}' inside static package directory 'olt/'. All runtime state must live in '.olt/'.`,
          );
        }
      }
    }
  }
}
