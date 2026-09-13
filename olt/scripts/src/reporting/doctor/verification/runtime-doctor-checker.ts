import { existsSync as defaultExistsSync, statSync as defaultStatSync } from "node:fs";
import { isAbsolute, normalize, resolve } from "node:path";

export const SEALED_TOOLCHAIN_INVARIANT = "SEALED_TOOLCHAIN_INVARIANT" as const;

export const SEALED_HARNESS_PREFIXES: readonly string[] = Object.freeze([
  "olt/scripts",
  ".agents/skills",
  "~/.agents/skills",
]);

export interface ToolchainSealingFinding {
  readonly path: string;
  readonly severity: "ERROR" | "WARN";
  readonly message: string;
  readonly invariant: typeof SEALED_TOOLCHAIN_INVARIANT;
}

export interface ToolchainSealingResult {
  readonly passed: boolean;
  readonly invariant: typeof SEALED_TOOLCHAIN_INVARIANT;
  readonly findings: readonly ToolchainSealingFinding[];
  readonly checkedCount: number;
}

export interface FileSystemAdapter {
  readonly existsSync?: ((path: string) => boolean) | undefined;
  readonly statSync?: ((path: string) => { mode: number }) | undefined;
}

export interface ToolchainSealingOptions {
  readonly repoRoot?: string | undefined;
  readonly writeScopes?: readonly (readonly string[])[] | undefined;
  readonly modifiedFiles?: readonly string[] | undefined;
  readonly fs?: FileSystemAdapter | undefined;
}

/**
 * Normalizes and determines whether a given path targets sealed harness source files.
 * Zero logical OR (||) usage per architectural lint invariant.
 */
export function isSealedHarnessPath(targetPath: string, repoRoot?: string): boolean {
  const trimmed = targetPath.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Direct check for home-relative agent skills
  if (trimmed.startsWith("~/.agents/skills")) {
    return true;
  }
  if (trimmed.includes(".agents/skills")) {
    return true;
  }

  // Normalize path relative to repository root if provided
  const normalized = normalize(trimmed).replace(/^[./]+/, "");
  for (const prefix of SEALED_HARNESS_PREFIXES) {
    const cleanPrefix = prefix.replace(/^[./]+/, "");
    if (normalized === cleanPrefix) {
      return true;
    }
    if (normalized.startsWith(`${cleanPrefix}/`)) {
      return true;
    }
  }

  if (repoRoot !== undefined && isAbsolute(trimmed)) {
    const absNormalized = normalize(trimmed);
    const absHarnessScripts = resolve(repoRoot, "olt", "scripts");
    if (absNormalized === absHarnessScripts) {
      return true;
    }
    if (absNormalized.startsWith(`${absHarnessScripts}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a collection of file paths against sealed toolchain constraints.
 */
export function validateWriteScopeSealing(
  writeScope: readonly string[],
  agentOrTaskId = "worker",
  repoRoot?: string,
): readonly ToolchainSealingFinding[] {
  const findings: ToolchainSealingFinding[] = [];

  for (const entry of writeScope) {
    if (isSealedHarnessPath(entry, repoRoot)) {
      findings.push({
        path: entry,
        severity: "ERROR",
        message: `Write scope violation for '${agentOrTaskId}': file '${entry}' is part of the sealed OLT harness and cannot be modified by workers.`,
        invariant: SEALED_TOOLCHAIN_INVARIANT,
      });
    }
  }

  return findings;
}

/**
 * Runtime doctor verification check ensuring workers cannot edit harness files
 * and that the toolchain sealing invariant is maintained.
 */
export function checkRuntimeToolchainSealing(
  options: ToolchainSealingOptions = {},
): ToolchainSealingResult {
  const findings: ToolchainSealingFinding[] = [];
  let checkedCount = 0;

  const existsFn =
    options.fs !== undefined && options.fs.existsSync !== undefined
      ? options.fs.existsSync
      : defaultExistsSync;
  const statFn =
    options.fs !== undefined && options.fs.statSync !== undefined
      ? options.fs.statSync
      : defaultStatSync;

  // 1. Verify provided write scopes
  if (options.writeScopes !== undefined) {
    for (const scope of options.writeScopes) {
      checkedCount += scope.length;
      const scopeFindings = validateWriteScopeSealing(scope, "worker-task", options.repoRoot);
      for (const finding of scopeFindings) {
        findings.push(finding);
      }
    }
  }

  // 2. Verify explicit modified files list if provided
  if (options.modifiedFiles !== undefined) {
    checkedCount += options.modifiedFiles.length;
    const modifiedFindings = validateWriteScopeSealing(
      options.modifiedFiles,
      "modified-files",
      options.repoRoot,
    );
    for (const finding of modifiedFindings) {
      findings.push(finding);
    }
  }

  // 3. Verify bin/olt wrapper existence and execution bit if repoRoot is supplied
  if (options.repoRoot !== undefined) {
    const binOltPath = resolve(options.repoRoot, "bin", "olt");
    checkedCount += 1;
    if (!existsFn(binOltPath)) {
      findings.push({
        path: "bin/olt",
        severity: "ERROR",
        message: "Missing executable wrapper 'bin/olt' for sealed OLT harness entrypoint.",
        invariant: SEALED_TOOLCHAIN_INVARIANT,
      });
    } else {
      try {
        const stats = statFn(binOltPath);
        // Check executable permission bit (0o111)
        if ((stats.mode & 0o111) === 0) {
          findings.push({
            path: "bin/olt",
            severity: "ERROR",
            message: "Wrapper script 'bin/olt' is not executable. Run chmod +x bin/olt.",
            invariant: SEALED_TOOLCHAIN_INVARIANT,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        findings.push({
          path: "bin/olt",
          severity: "ERROR",
          message: `Failed to inspect 'bin/olt' permissions: ${message}`,
          invariant: SEALED_TOOLCHAIN_INVARIANT,
        });
      }
    }
  }

  return {
    passed: findings.length === 0,
    invariant: SEALED_TOOLCHAIN_INVARIANT,
    findings: Object.freeze(findings),
    checkedCount,
  };
}
