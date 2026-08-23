import { safeRepoPath } from "../core/paths.ts";
import { HarnessError } from "../errors/harness-error.ts";

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
