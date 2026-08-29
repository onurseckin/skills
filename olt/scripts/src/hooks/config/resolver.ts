import { existsSync, lstatSync, statSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";

function isInsideRepo(repoRoot: string, targetPath: string): boolean {
  const pathFromRoot = relative(repoRoot, targetPath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  );
}

function canonicalHookConfigPath(repoRoot: string): string {
  return join(repoRoot, ".olt", "capsules", "hooks.json");
}

function assertTrustedHookConfig(filePath: string, repoRoot: string): void {
  const fileInfo = lstatSync(filePath);
  if (!fileInfo.isFile()) {
    throw new HarnessError("PATH_SAFETY", `hook config is not a regular file: '${filePath}'`);
  }

  const realRepoRoot = realpathSync(repoRoot);
  const realConfigPath = realpathSync(filePath);
  if (!isInsideRepo(realRepoRoot, realConfigPath)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `hook config resolves outside repository root: '${filePath}'`,
    );
  }

  if (process.platform !== "win32") {
    const fileStat = statSync(filePath);
    if (typeof process.getuid === "function" && fileStat.uid !== process.getuid()) {
      throw new HarnessError(
        "INTEGRITY",
        `hook config is not owned by the current user: '${filePath}'`,
      );
    }
    if ((fileStat.mode & 0o022) !== 0) {
      throw new HarnessError("INTEGRITY", `hook config is group or world writable: '${filePath}'`);
    }
  }
}

export function resolveHookConfigFile(
  explicitPathOrDir?: string | undefined,
  cwd: string = process.cwd(),
): string | null {
  if (explicitPathOrDir !== undefined && explicitPathOrDir.trim().length > 0) {
    const resolved = resolve(cwd, explicitPathOrDir.trim());
    if (existsSync(resolved)) {
      const stat = lstatSync(resolved);
      if (stat.isSymbolicLink()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config path must not be a symlink: '${resolved}'`,
        );
      }
      if (stat.isFile()) {
        const repoRoot = findRepoRoot(cwd);
        if (!isInsideRepo(repoRoot, resolved)) {
          throw new HarnessError(
            "PATH_SAFETY",
            `hook config is outside repository root: '${resolved}'`,
          );
        }
        assertTrustedHookConfig(resolved, repoRoot);
        return resolved;
      }
      if (!stat.isDirectory()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config path is not a directory or file: '${resolved}'`,
        );
      }
      const repoRoot = findRepoRoot(resolved);
      const candidate = canonicalHookConfigPath(repoRoot);
      if (!existsSync(candidate)) {
        return null;
      }
      assertTrustedHookConfig(candidate, repoRoot);
      return candidate;
    }

    if (resolved.endsWith(".json")) {
      const repoRoot = findRepoRoot(cwd);
      if (!isInsideRepo(repoRoot, resolved)) {
        throw new HarnessError(
          "PATH_SAFETY",
          `hook config is outside repository root: '${resolved}'`,
        );
      }
      return resolved;
    }
  }

  const repoRoot = findRepoRoot(cwd);
  const candidate = canonicalHookConfigPath(repoRoot);
  if (!existsSync(candidate)) {
    return null;
  }
  assertTrustedHookConfig(candidate, repoRoot);
  return candidate;
}
