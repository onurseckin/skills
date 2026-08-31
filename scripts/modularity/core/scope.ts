import { extname } from "node:path";
import type { ScopeDecision, Violation } from "./contracts.ts";
import { assertRepositoryRelativePosixPath } from "./errors.ts";

const APPROVED_ROOT_PATHS = new Set([
  ".capture.yaml",
  ".gitignore",
  ".oxfmtrc.json",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "bunfig.toml",
  "lefthook.yml",
  "package.json",
  "tsconfig.json",
]);

const EXCLUDED_ROOTS = new Set([
  ".git",
  ".olt",
  "build",
  "cache",
  "capsules",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "scratch",
  "vendor",
  "vendored",
  "third_party",
]);

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const EXCLUDED: ScopeDecision = {
  included: false,
  lineLimited: false,
  fanoutCounted: false,
  importScanned: false,
};

const FANOUT_ONLY: ScopeDecision = {
  included: true,
  lineLimited: false,
  fanoutCounted: true,
  importScanned: false,
};

const DATA_FILE: ScopeDecision = {
  included: true,
  lineLimited: true,
  fanoutCounted: true,
  importScanned: false,
};

const TYPESCRIPT_FILE: ScopeDecision = {
  included: true,
  lineLimited: true,
  fanoutCounted: true,
  importScanned: true,
};

function hasExcludedDirectory(path: string): boolean {
  const segments = path.split("/");
  return segments.some((segment, index) => {
    if (EXCLUDED_ROOTS.has(segment)) return true;
    if (segment === ".cache") return true;
    if (index === 0 && segment === "runtime") return true;
    return false;
  });
}

function isGeneratedCliArtifact(path: string): boolean {
  return path.startsWith("olt/references/cli-capabilities/");
}

function isModularityBaselineArtifact(path: string): boolean {
  return path.startsWith("scripts/modularity/baseline/");
}

function isNonTypeScriptFixture(path: string, extension: string): boolean {
  if (extension === ".ts") return false;
  if (extension === ".tsx") return false;
  if (extension === ".mts") return false;
  if (extension === ".cts") return false;
  return path.split("/").some((segment) => {
    if (segment === "fixtures") return true;
    if (segment === "__snapshots__") return true;
    return false;
  });
}

export function classifyPath(path: string): ScopeDecision {
  assertRepositoryRelativePosixPath(path);

  if (hasExcludedDirectory(path)) {
    return EXCLUDED;
  }
  if (LOCKFILES.has(path)) {
    return EXCLUDED;
  }

  if (isModularityBaselineArtifact(path)) {
    return FANOUT_ONLY;
  }

  if (isGeneratedCliArtifact(path)) {
    return DATA_FILE;
  }

  const extension = extname(path);
  if (extension === ".ts") return TYPESCRIPT_FILE;
  if (extension === ".tsx") return TYPESCRIPT_FILE;
  if (extension === ".mts") return TYPESCRIPT_FILE;
  if (extension === ".cts") return TYPESCRIPT_FILE;

  if (isNonTypeScriptFixture(path, extension)) {
    return FANOUT_ONLY;
  }

  if (extension === ".json") {
    return DATA_FILE;
  }

  if (extension === ".jsonl") return FANOUT_ONLY;
  if (extension === ".md") return FANOUT_ONLY;
  if (extension === ".yaml") return FANOUT_ONLY;
  if (extension === ".yml") return FANOUT_ONLY;

  return EXCLUDED;
}

export function assertRootConvention(paths: readonly string[]): Violation[] {
  return paths
    .filter((path) => {
      if (path.includes("/")) return false;
      if (LOCKFILES.has(path)) return false;
      if (APPROVED_ROOT_PATHS.has(path)) return false;
      return true;
    })
    .sort()
    .map((path) => ({
      rule: "root_no_growth" as const,
      path,
      observed: path,
      detail: "Root path is not in the approved conventional set.",
    }));
}
