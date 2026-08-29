import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES } from "../../authority/guards/constants.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { quarantineViolations } from "./quarantine.ts";
import {
  DEFAULT_ALLOWED_SCRIPTS_DIRS,
  DEFAULT_ALLOWED_SCRIPTS_FILES,
  EXECUTABLE_EXTENSIONS,
  SCRATCH_PATTERNS,
  TEST_ARTIFACT_PATTERNS,
} from "./types.ts";
import type {
  HygieneViolationType,
  QuarantinedFileRecord,
  RootHygieneFinding,
  RootHygieneOptions,
  RootHygieneScanResult,
} from "./types.ts";

export function isExecutable(fullPath: string, mode: number): boolean {
  if ((mode & 0o111) !== 0) return true;
  return EXECUTABLE_EXTENSIONS.has(extname(fullPath).toLowerCase());
}

export function scanRepoRoot(
  root: string,
  allowedFiles: ReadonlySet<string>,
  allowedDirs: ReadonlySet<string>,
): { count: number; findings: RootHygieneFinding[] } {
  const findings: RootHygieneFinding[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return { count: 0, findings: [] };
  }
  for (const entry of entries) {
    const fullPath = join(root, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.isFile() && !allowedFiles.has(entry)) {
        const isScratch = SCRATCH_PATTERNS.some((p) => p.test(entry));
        const isExec = isExecutable(fullPath, stats.mode);
        const violationType: HygieneViolationType = isScratch
          ? "UNCONFINED_SCRATCH_SCRIPT"
          : isExec
            ? "LOOSE_EXECUTABLE"
            : "UNAPPROVED_ROOT_FILE";
        findings.push({
          path: fullPath, relativePath: entry, scope: "repo_root",
          violationType, severity: "ERROR",
          message: `Unapproved file '${entry}' in root.`,
          isExecutable: isExec, sizeBytes: stats.size,
        });
      } else if (stats.isDirectory() && !allowedDirs.has(entry)) {
        findings.push({
          path: fullPath, relativePath: entry, scope: "repo_root",
          violationType: "UNAPPROVED_ROOT_DIR", severity: "ERROR",
          message: `Unapproved directory '${entry}' in root.`,
          isExecutable: false, sizeBytes: 0,
        });
      }
    } catch {
      continue;
    }
  }
  return { count: entries.length, findings };
}

export function scanScriptsRoot(
  scriptsDir: string,
  repoRoot: string,
  allowedFiles: ReadonlySet<string>,
  allowedDirs: ReadonlySet<string>,
): { count: number; findings: RootHygieneFinding[] } {
  if (!existsSync(scriptsDir)) return { count: 0, findings: [] };
  const findings: RootHygieneFinding[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(scriptsDir);
  } catch {
    return { count: 0, findings: [] };
  }
  for (const entry of entries) {
    const fullPath = join(scriptsDir, entry);
    const relPath = relative(repoRoot, fullPath);
    try {
      const stats = statSync(fullPath);
      if (stats.isFile() && !allowedFiles.has(entry)) {
        const isTestArt = TEST_ARTIFACT_PATTERNS.some((p) => p.test(entry));
        const isExec = isExecutable(fullPath, stats.mode);
        const violationType: HygieneViolationType = isTestArt
          ? "TEST_ARTIFACT_IN_SCRIPTS"
          : isExec
            ? "LOOSE_EXECUTABLE"
            : "MISPLACED_FILE";
        findings.push({
          path: fullPath, relativePath: relPath, scope: "scripts_root",
          violationType, severity: "ERROR",
          message: `Loose executable or test artifact '${entry}' in scripts/ root.`,
          isExecutable: isExec, sizeBytes: stats.size,
        });
      } else if (stats.isDirectory() && !allowedDirs.has(entry)) {
        findings.push({
          path: fullPath, relativePath: relPath, scope: "scripts_root",
          violationType: "UNAPPROVED_ROOT_DIR", severity: "ERROR",
          message: `Unapproved directory '${entry}' in scripts/ root.`,
          isExecutable: false, sizeBytes: 0,
        });
      }
    } catch {
      continue;
    }
  }
  return { count: entries.length, findings };
}

export function scanStaticPackage(
  oltDir: string,
  repoRoot: string,
): { count: number; findings: RootHygieneFinding[] } {
  if (!existsSync(oltDir)) return { count: 0, findings: [] };
  const findings: RootHygieneFinding[] = [];
  let count = 0;
  function traverse(dir: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      count += 1;
      const fullPath = join(dir, entry);
      const relPath = relative(repoRoot, fullPath);
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          if (["coverage", ".coverage", "logs", "quarantine"].includes(entry)) {
            findings.push({
              path: fullPath, relativePath: relPath, scope: "static_package",
              violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION", severity: "ERROR",
              message: `Runtime directory '${entry}' in static package 'olt/'.`,
              isExecutable: false, sizeBytes: 0,
            });
          } else if (entry !== "references") {
            traverse(fullPath);
          }
        } else if (
          stats.isFile() &&
          (entry.endsWith(".jsonl") || entry.endsWith(".log") || entry === "defects.jsonl")
        ) {
          findings.push({
            path: fullPath, relativePath: relPath, scope: "static_package",
            violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION", severity: "ERROR",
            message: `Runtime file '${entry}' in static package 'olt/'.`,
            isExecutable: false, sizeBytes: stats.size,
          });
        }
      } catch {
        continue;
      }
    }
  }
  traverse(oltDir);
  return { count, findings };
}

export function scanRootHygiene(options: RootHygieneOptions = {}): RootHygieneScanResult {
  const startTime = Date.now();
  const repoRoot = resolve(typeof options.repoRoot === "string" ? options.repoRoot : process.cwd());
  const rootRes = scanRepoRoot(
    repoRoot,
    options.allowedRootFiles ?? ALLOWED_ROOT_FILES,
    options.allowedRootDirNames ?? ALLOWED_ROOT_DIRS,
  );
  const scriptsRes = scanScriptsRoot(
    join(repoRoot, "scripts"), repoRoot,
    options.allowedScriptsFiles ?? DEFAULT_ALLOWED_SCRIPTS_FILES,
    options.allowedScriptsDirs ?? DEFAULT_ALLOWED_SCRIPTS_DIRS,
  );
  const oltRes = scanStaticPackage(join(repoRoot, "olt"), repoRoot);
  const violations: RootHygieneFinding[] = [
    ...rootRes.findings, ...scriptsRes.findings, ...oltRes.findings,
  ];
  const quarantinedFiles = options.fix === true && violations.length > 0
    ? quarantineViolations(repoRoot, violations, options.quarantineDir)
    : [];
  return {
    passed: violations.length === 0, repoRoot,
    totalEntriesScanned: rootRes.count + scriptsRes.count + oltRes.count,
    violations, quarantinedFiles,
    scanDurationMs: Date.now() - startTime,
  };
}

export function assertCleanRootHygiene(options: RootHygieneOptions = {}): void {
  const result = scanRootHygiene(options);
  if (!result.passed) {
    const summary = result.violations
      .map((v) => `[${v.scope}] ${v.violationType}: ${v.relativePath}`).join(", ");
    throw new HarnessError(
      "PATH_SAFETY",
      `[ROOT_HYGIENE_VIOLATION] Hygiene violations detected: ${summary}`,
    );
  }
}

export class RootHygieneEngine {
  public constructor(private readonly options: RootHygieneOptions = {}) {}
  public scan(overrides?: RootHygieneOptions): RootHygieneScanResult {
    return scanRootHygiene({ ...this.options, ...overrides });
  }
  public quarantine(violations: readonly RootHygieneFinding[], qDir?: string): QuarantinedFileRecord[] {
    return quarantineViolations(
      resolve(this.options.repoRoot ?? process.cwd()), violations, qDir ?? this.options.quarantineDir,
    );
  }
  public assertClean(overrides?: RootHygieneOptions): void {
    assertCleanRootHygiene({ ...this.options, ...overrides });
  }
  public static scan(options?: RootHygieneOptions): RootHygieneScanResult {
    return scanRootHygiene(options);
  }
  public static quarantine(
    repoRoot: string, violations: readonly RootHygieneFinding[], targetQuarantineDir?: string,
  ): QuarantinedFileRecord[] {
    return quarantineViolations(repoRoot, violations, targetQuarantineDir);
  }
  public static assertClean(options?: RootHygieneOptions): void {
    assertCleanRootHygiene(options);
  }
}
