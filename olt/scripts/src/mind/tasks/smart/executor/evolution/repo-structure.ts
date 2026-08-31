import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "../../../../../core/shared/paths.ts";

export interface DetectedRepositoryStructure {
  readonly repoRoot: string;
  readonly apps: readonly string[];
  readonly packages: readonly string[];
  readonly src: readonly string[];
  readonly tests: readonly string[];
  readonly docs: readonly string[];
  readonly planning: readonly string[];
  readonly hasApps: boolean;
  readonly hasPackages: boolean;
  readonly hasSrc: boolean;
  readonly hasTests: boolean;
  readonly hasDocs: boolean;
  readonly hasPlanning: boolean;
}

export function detectRepositoryStructure(customRoot?: string): DetectedRepositoryStructure {
  let root = customRoot ? resolve(customRoot) : undefined;
  if (!root || !existsSync(root)) {
    try {
      root = findRepoRoot();
    } catch {
      root = process.cwd();
    }
  }

  const listSubdirs = (relDir: string): string[] => {
    const full = join(root, relDir);
    if (!existsSync(full)) return [];
    try {
      return readdirSync(full, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith("."))
        .map((dirent) => `${relDir}/${dirent.name}`);
    } catch {
      return [];
    }
  };

  const hasDir = (relDir: string): boolean => existsSync(join(root, relDir));

  const appDirs = hasDir("apps")
    ? ["apps", ...listSubdirs("apps")]
    : hasDir("app")
      ? ["app", ...listSubdirs("app")]
      : [];

  const pkgDirs = hasDir("packages")
    ? ["packages", ...listSubdirs("packages")]
    : hasDir("pkg")
      ? ["pkg", ...listSubdirs("pkg")]
      : hasDir("modules")
        ? ["modules", ...listSubdirs("modules")]
        : [];

  const srcDirs = hasDir("src")
    ? ["src", ...listSubdirs("src")]
    : hasDir("lib")
      ? ["lib", ...listSubdirs("lib")]
      : hasDir("olt/scripts/src")
        ? ["olt/scripts/src"]
        : [];

  const testDirs = hasDir("tests")
    ? ["tests", ...listSubdirs("tests")]
    : hasDir("test")
      ? ["test", ...listSubdirs("test")]
      : hasDir("spec")
        ? ["spec", ...listSubdirs("spec")]
        : [];

  const docDirs = hasDir("docs")
    ? ["docs", ...listSubdirs("docs")]
    : hasDir("documentation")
      ? ["documentation"]
      : [];

  const planningDirs = hasDir("docs/planning")
    ? ["docs/planning"]
    : hasDir("planning")
      ? ["planning"]
      : [];

  return {
    repoRoot: root,
    apps: appDirs,
    packages: pkgDirs,
    src: srcDirs,
    tests: testDirs,
    docs: docDirs,
    planning: planningDirs,
    hasApps: appDirs.length > 0,
    hasPackages: pkgDirs.length > 0,
    hasSrc: srcDirs.length > 0,
    hasTests: testDirs.length > 0,
    hasDocs: docDirs.length > 0,
    hasPlanning: planningDirs.length > 0,
  };
}
