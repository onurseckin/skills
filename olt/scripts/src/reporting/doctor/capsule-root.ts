import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export interface CapsuleRootAuditResult {
  readonly valid: boolean;
  readonly runRoot: string;
  readonly repoRoot: string;
  readonly isAtRepoRoot: boolean;
  readonly misplacedCapsules: readonly string[];
  readonly issues: readonly string[];
}

export function findRepositoryRoot(startPath: string): string {
  let current = resolve(startPath);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  current = resolve(startPath);
  if (current.includes(".capsules")) {
    const parts = current.split(`${sep}.capsules`);
    if (parts[0] && existsSync(parts[0])) {
      return parts[0];
    }
  }
  return process.cwd();
}

const CAPSULES_SUBDIR_NAME = "capsules";
const LEGACY_CAPSULES_NAME = ".capsules";
const OLT_DIR_NAME = ".olt";

export function scanMisplacedCapsulesDirectories(
  repoRoot: string,
  maxDepth = 4,
  currentDepth = 0,
): string[] {
  if (!existsSync(repoRoot) || currentDepth > maxDepth) return [];
  const misplaced: string[] = [];

  try {
    const entries = readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (name === "node_modules" || name === ".git" || name === ".tmp" || name === "coverage") {
        continue;
      }

      const fullPath = join(repoRoot, name);
      if (!entry.isDirectory()) {
        continue;
      }

      if (name === CAPSULES_SUBDIR_NAME) {
        misplaced.push(fullPath);
        continue;
      }

      if (name === LEGACY_CAPSULES_NAME) {
        if (currentDepth > 0) {
          misplaced.push(fullPath);
        }
        continue;
      }

      if (name === OLT_DIR_NAME) {
        const nestedCapsules = join(fullPath, CAPSULES_SUBDIR_NAME);
        if (currentDepth > 0 && existsSync(nestedCapsules)) {
          misplaced.push(nestedCapsules);
        }
        continue;
      }

      misplaced.push(...scanMisplacedCapsulesDirectories(fullPath, maxDepth, currentDepth + 1));
    }
  } catch {
    return misplaced;
  }
  return misplaced;
}

export function verifyStrictRepositoryCapsuleRoot(
  runRoot: string,
  explicitRepoRoot?: string,
): CapsuleRootAuditResult {
  const issues: string[] = [];
  let resolvedRunRoot = resolve(runRoot);
  try {
    if (existsSync(resolvedRunRoot)) resolvedRunRoot = realpathSync(resolvedRunRoot);
  } catch {

  }

  let repoRoot = explicitRepoRoot ? resolve(explicitRepoRoot) : findRepositoryRoot(resolvedRunRoot);
  try {
    if (existsSync(repoRoot)) repoRoot = realpathSync(repoRoot);
  } catch {

  }

  const canonicalCapsulesDir = join(repoRoot, OLT_DIR_NAME, CAPSULES_SUBDIR_NAME);
  const legacyCapsulesDir = join(repoRoot, LEGACY_CAPSULES_NAME);
  const relFromRepo = relative(repoRoot, resolvedRunRoot).replace(/\\/g, "/");

  const isDirectChildOf = (prefix: string): boolean =>
    relFromRepo.startsWith(prefix) &&
    !relFromRepo.slice(prefix.length).includes("/.capsules") &&
    !relFromRepo.slice(prefix.length).includes("/.olt");

  const isAtRepoRoot =
    isDirectChildOf(`${OLT_DIR_NAME}/${CAPSULES_SUBDIR_NAME}/`) ||
    isDirectChildOf(`${LEGACY_CAPSULES_NAME}/`);

  if (!isAtRepoRoot) {
    issues.push(
      `Run capsule path "${resolvedRunRoot}" violates repository root confinement: capsules must reside directly under the canonical "${canonicalCapsulesDir}" (or legacy "${legacyCapsulesDir}") directory`,
    );
  }

  const misplacedCapsules = scanMisplacedCapsulesDirectories(repoRoot);
  for (const misplaced of misplacedCapsules) {
    const leaf = misplaced.split(sep).pop() ?? misplaced;
    const parentName = dirname(misplaced).split(sep).pop();
    const isBare = leaf === CAPSULES_SUBDIR_NAME && parentName !== OLT_DIR_NAME;
    issues.push(
      isBare
        ? `Bare, undotted "${misplaced}" directory detected: capsule storage must be dot-prefixed ("${canonicalCapsulesDir}" or legacy "${legacyCapsulesDir}"), a bare "capsules/" directory must never exist`
        : `Misplaced nested .capsules directory detected at "${misplaced}": all capsules must reside strictly in "${canonicalCapsulesDir}" (or legacy "${legacyCapsulesDir}")`,
    );
  }

  return {
    valid: issues.length === 0,
    runRoot: resolvedRunRoot,
    repoRoot,
    isAtRepoRoot,
    misplacedCapsules,
    issues,
  };
}
