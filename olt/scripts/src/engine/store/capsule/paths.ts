import { safeRepoPath } from "../../../core/paths.ts";
import { isInsideCapsule, resolveCapsulesDir } from "../../../core/shared/paths.ts";
import { HarnessError } from "../../../core/errors/index.ts";

export { safeRepoPath, isInsideCapsule, resolveCapsulesDir };

export function runFilePath(runRoot: string, name: string): string {
  try {
    return safeRepoPath(runRoot, name);
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `unsafe ${name} path: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
