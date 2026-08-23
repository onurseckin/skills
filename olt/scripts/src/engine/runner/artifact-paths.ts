import { isAbsolute, relative, sep } from "node:path";
import { safeRepoPath } from "../../core/paths.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";

export function portableArtifactPath(runRoot: string, absolutePath: string): string {
  const fromRoot = relative(runRoot, absolutePath);
  if (!fromRoot || isAbsolute(fromRoot) || fromRoot.split(sep).includes("../..")) {
    throw new HarnessError("PATH_SAFETY", `command artifact escapes run root: ${absolutePath}`);
  }
  safeRepoPath(runRoot, fromRoot);
  return fromRoot.split(sep).join("/");
}

export function resolveArtifactPath(runRoot: string, portablePath: string): string {
  if (portablePath.includes("\\") || portablePath.split("/").includes("..")) {
    throw new HarnessError("PATH_SAFETY", `invalid portable artifact path: ${portablePath}`);
  }
  return safeRepoPath(runRoot, portablePath);
}
