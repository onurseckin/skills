import { quarantineViolations, scanRootHygiene } from "../../health/hygiene/index.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

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

export async function executeHygieneFix(_argv: readonly string[]): Promise<number> {
  const scanResult = scanRootHygiene({});
  const quarantinedFiles =
    scanResult.violations.length > 0
      ? quarantineViolations(scanResult.repoRoot, scanResult.violations)
      : [];
  process.stdout.write(
    JSON.stringify({
      passed: scanResult.passed,
      violations: scanResult.violations,
      quarantinedFiles,
      totalQuarantined: quarantinedFiles.length,
    }) + "\n",
  );
  return 0;
}
