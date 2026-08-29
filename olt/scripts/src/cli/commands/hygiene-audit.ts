import { scanRootHygiene } from "../../health/hygiene/index.ts";
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

export async function executeHygieneAudit(argv: readonly string[]): Promise<number> {
  const result = scanRootHygiene({});
  process.stdout.write(JSON.stringify(result) + "\n");
  return result.passed ? 0 : 1;
}
