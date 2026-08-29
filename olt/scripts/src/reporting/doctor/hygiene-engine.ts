import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES } from "../../authority/guards/constants.ts";
import type { RepositoryHygieneFinding, RepositoryHygieneResult } from "./types.ts";

export interface RepositoryHygieneOptions {
  readonly repoRoot?: string | undefined;
  readonly fix?: boolean | undefined;
}

const SCRATCH_SCRIPT_PATTERNS = [
  /^fix-.*\.ts$/u,
  /^refactor-.*\.ts$/u,
  /^temp-.*\.ts$/u,
  /^test-.*\.ts$/u,
  /^scratch.*\.ts$/u,
  /.*\.tmp$/u,
];

/**
 * Purges or migrates orphaned scratch files from the repository root to `scratch/orphaned/`.
 */
export function purgeOrphanedScratch(repoRoot: string): string[] {
  const root = resolve(repoRoot);
  const orphanedDir = join(root, "scratch", "orphaned");
  const scrubbed: string[] = [];

  if (!existsSync(root)) return scrubbed;

  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return scrubbed;
  }

  for (const entry of entries) {
    if (ALLOWED_ROOT_FILES.has(entry) || ALLOWED_ROOT_DIRS.has(entry)) continue;

    const fullPath = join(root, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.isFile()) {
        if (!existsSync(orphanedDir)) {
          mkdirSync(orphanedDir, { recursive: true, mode: 0o700 });
        }
        const targetPath = join(orphanedDir, `${Date.now()}-${entry}`);
        renameSync(fullPath, targetPath);
        scrubbed.push(entry);
      }
    } catch {
      // Ignore migration errors
    }
  }

  return scrubbed;
}

/**
 * Cleanses runtime pollution inside static package directory `olt/`.
 */
function cleanStaticPackagePollution(
  oltDir: string,
  fix: boolean,
): { findings: RepositoryHygieneFinding[]; scrubbed: string[] } {
  const findings: RepositoryHygieneFinding[] = [];
  const scrubbed: string[] = [];

  if (!existsSync(oltDir)) return { findings, scrubbed };

  function scanDir(dir: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          if (
            entry === "coverage" ||
            entry === ".coverage" ||
            entry === "logs" ||
            entry === "quarantine"
          ) {
            findings.push({
              path: fullPath,
              violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION",
              severity: "ERROR",
              message: `Runtime directory '${entry}' detected inside static package directory 'olt/'. All runtime state must live in '.olt/'.`,
            });
            if (fix) {
              try {
                // best effort remove
                unlinkSync(fullPath);
                scrubbed.push(fullPath);
              } catch {
                // ignore
              }
            }
          } else {
            scanDir(fullPath);
          }
        } else if (stats.isFile()) {
          if (entry.endsWith(".jsonl") || entry.endsWith(".log") || entry === "defects.jsonl") {
            findings.push({
              path: fullPath,
              violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION",
              severity: "ERROR",
              message: `Runtime ledger or log file '${entry}' detected inside static package directory 'olt/'. All runtime state must live in '.olt/'.`,
            });
            if (fix) {
              try {
                unlinkSync(fullPath);
                scrubbed.push(fullPath);
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // Ignore read/stat error
      }
    }
  }

  scanDir(oltDir);
  return { findings, scrubbed };
}

/**
 * Audits repository root and static package purity against Invariant 30.
 */
export function checkRepositoryHygiene(
  options: RepositoryHygieneOptions = {},
): RepositoryHygieneResult {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const fix = options.fix ?? false;
  const violations: RepositoryHygieneFinding[] = [];
  const scrubbedFiles: string[] = [];

  if (!existsSync(repoRoot)) {
    return { passed: true, violations: [], scrubbedFiles: [] };
  }

  // 1. Audit repository root files and directories
  let rootEntries: string[] = [];
  try {
    rootEntries = readdirSync(repoRoot);
  } catch {
    return { passed: true, violations: [], scrubbedFiles: [] };
  }

  for (const entry of rootEntries) {
    const fullPath = join(repoRoot, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.isFile()) {
        if (!ALLOWED_ROOT_FILES.has(entry)) {
          const isScratch =
            SCRATCH_SCRIPT_PATTERNS.some((p) => p.test(entry)) ||
            entry.endsWith(".sh") ||
            entry.endsWith(".py") ||
            entry.endsWith(".tmp");

          violations.push({
            path: fullPath,
            violationType: isScratch ? "UNCONFINED_SCRATCH_SCRIPT" : "UNAPPROVED_ROOT_FILE",
            severity: "ERROR",
            message: `Unapproved file '${entry}' detected in repository root. Permitted files: ${Array.from(ALLOWED_ROOT_FILES).join(", ")}.`,
          });

          if (fix) {
            const orphanedDir = join(repoRoot, "scratch", "orphaned");
            if (!existsSync(orphanedDir)) {
              mkdirSync(orphanedDir, { recursive: true, mode: 0o700 });
            }
            const target = join(orphanedDir, `${Date.now()}-${entry}`);
            try {
              renameSync(fullPath, target);
              scrubbedFiles.push(entry);
            } catch {
              // ignore
            }
          }
        }
      } else if (stats.isDirectory()) {
        if (!ALLOWED_ROOT_DIRS.has(entry)) {
          violations.push({
            path: fullPath,
            violationType: "UNAPPROVED_ROOT_DIR",
            severity: "ERROR",
            message: `Unapproved directory '${entry}' detected in repository root. Permitted directories: ${Array.from(ALLOWED_ROOT_DIRS).join(", ")}.`,
          });
        }
      }
    } catch {
      // Ignore stat error
    }
  }

  // 2. Audit static package directory `olt/`
  const oltDir = join(repoRoot, "olt");
  const oltResult = cleanStaticPackagePollution(oltDir, fix);
  violations.push(...oltResult.findings);
  scrubbedFiles.push(...oltResult.scrubbed);

  return {
    passed: violations.length === 0,
    violations,
    scrubbedFiles,
  };
}
