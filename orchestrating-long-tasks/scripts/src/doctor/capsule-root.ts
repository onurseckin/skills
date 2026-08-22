import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export interface CapsuleRootAuditResult {
  readonly valid: boolean;
  readonly runRoot: string;
  readonly repoRoot: string;
  readonly isAtRepoRoot: boolean;
  readonly misplacedCapsules: readonly string[];
  readonly issues: readonly string[];
}

/**
 * Finds the repository root by walking upwards looking for .git or package.json.
 */
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
  // Fallback if .git not found: walk looking for .capsules at top-most directory
  current = resolve(startPath);
  if (current.includes(".capsules")) {
    const parts = current.split(`${sep}.capsules`);
    if (parts[0] && existsSync(parts[0])) {
      return parts[0];
    }
  }
  return process.cwd();
}

/**
 * Scans repository subdirectories to detect any illegal nested .capsules directories.
 */
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
      if (name === "node_modules" || name === ".git" || name === ".tmp") {
        continue;
      }

      const fullPath = join(repoRoot, name);
      if (entry.isDirectory()) {
        if (name === ".capsules") {
          // If currentDepth > 0, this .capsules is nested inside a subdirectory, which violates repository-root policy!
          if (currentDepth > 0) {
            misplaced.push(fullPath);
          }
        } else {
          misplaced.push(...scanMisplacedCapsulesDirectories(fullPath, maxDepth, currentDepth + 1));
        }
      }
    }
  } catch {
    // Ignore read errors during filesystem scanning
  }

  return misplaced;
}

/**
 * Verifies that .capsules strictly and exclusively resides at repository root (<repo-root>/.capsules/).
 */
export function verifyStrictRepositoryCapsuleRoot(
  runRoot: string,
  explicitRepoRoot?: string,
): CapsuleRootAuditResult {
  const issues: string[] = [];
  const resolvedRunRoot = resolve(runRoot);
  const repoRoot = explicitRepoRoot ? resolve(explicitRepoRoot) : findRepositoryRoot(resolvedRunRoot);

  const expectedCapsulesDir = join(repoRoot, ".capsules");
  const relFromRepo = relative(repoRoot, resolvedRunRoot).replace(/\\/g, "/");

  // Check 1: runRoot must be directly inside <repo-root>/.capsules/<run-id>
  const isDirectChildOfRootCapsules =
    relFromRepo.startsWith(".capsules/") &&
    !relFromRepo.slice(".capsules/".length).includes("/.capsules");

  const isAtRepoRoot = isDirectChildOfRootCapsules && !relFromRepo.startsWith("../");

  if (!isAtRepoRoot) {
    issues.push(
      `Run capsule path "${resolvedRunRoot}" violates repository root confinement: .capsules must exclusively reside at repository root "${expectedCapsulesDir}"`,
    );
  }

  // Check 2: Scan for misplaced/nested .capsules directories
  const misplacedCapsules = scanMisplacedCapsulesDirectories(repoRoot);
  for (const misplaced of misplacedCapsules) {
    issues.push(
      `Misplaced nested .capsules directory detected at "${misplaced}": all capsules must reside strictly in "<repo-root>/.capsules/"`,
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
