import { quarantineViolations, scanRootHygiene } from "../../health/hygiene/index.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export function hygieneAuditCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const repoRoot = textFlag(flags, "repo-root", false) ?? textFlag(flags, "root", false);
  const fix = boolFlag(flags, "fix");
  const quarantineDir = textFlag(flags, "quarantine-dir", false);

  const result = scanRootHygiene({
    repoRoot,
    fix,
    quarantineDir,
  });

  return {
    passed: result.passed,
    repoRoot: result.repoRoot,
    totalEntriesScanned: result.totalEntriesScanned,
    violations: result.violations,
    quarantinedFiles: result.quarantinedFiles,
    scanDurationMs: result.scanDurationMs,
  };
}

export function hygieneFixCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const repoRoot = textFlag(flags, "repo-root", false) ?? textFlag(flags, "root", false);
  const quarantineDir = textFlag(flags, "quarantine-dir", false);

  const scanResult = scanRootHygiene({
    repoRoot,
    quarantineDir,
  });

  const quarantinedFiles =
    scanResult.violations.length > 0
      ? quarantineViolations(scanResult.repoRoot, scanResult.violations, quarantineDir)
      : [];

  return {
    passed: scanResult.passed,
    violations: scanResult.violations,
    quarantinedFiles,
    totalQuarantined: quarantinedFiles.length,
  };
}
