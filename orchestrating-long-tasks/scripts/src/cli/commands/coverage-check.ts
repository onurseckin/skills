/**
 * Coverage checker CLI command: executes bun test with coverage and verifies that
 * all production TypeScript source files meet the configured coverage threshold (default 95%).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../errors/harness-error.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface FileCoverageRecord {
  readonly file: string;
  readonly lines: number;
  readonly functions: number;
  readonly statements: number;
}

export interface CoverageAuditSummary {
  readonly passed: boolean;
  readonly threshold: number;
  readonly totalFiles: number;
  readonly failingFiles: readonly FileCoverageRecord[];
  readonly markdown: string;
}

export function parseCoverageTable(output: string): FileCoverageRecord[] {
  const records: FileCoverageRecord[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*(\S+\.ts)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
    if (match) {
      const file = match[1];
      const rawLine = match[2];
      const rawStmt = match[3];
      if (file !== undefined && rawLine !== undefined && rawStmt !== undefined) {
        const linePct = parseFloat(rawLine) / 100;
        const stmtPct = parseFloat(rawStmt) / 100;
        records.push({
          file,
          lines: linePct,
          functions: linePct,
          statements: stmtPct,
        });
      }
    }
  }

  return records;
}

export async function coverageCheckCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const rawThreshold = textFlag(flags, "threshold", false);
  const threshold = rawThreshold !== undefined ? Number(rawThreshold) : 0.95;
  const strict = Boolean(flags.strict);
  const rawDir = textFlag(flags, "dir", false);
  const targetDir = rawDir !== undefined ? rawDir : ".";

  const resolvedDir = resolve(targetDir);
  if (!existsSync(resolvedDir)) {
    throw new HarnessError("INVALID_ARGUMENT", `Target directory does not exist: ${resolvedDir}`);
  }

  const result = spawnSync("bun", ["test", "--coverage", "tests/unit"], {
    cwd: resolvedDir,
    encoding: "utf-8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? 1;

  const output = `${stdout}\n${stderr}`;
  const tableRows = parseCoverageTable(output);

  const failing = tableRows.filter(
    (row) => row.lines < threshold || row.statements < threshold,
  );
  const passed = exitCode === 0 && failing.length === 0;

  const markdown = [
    `### Coverage Check Certification`,
    `- **Threshold**: ${(threshold * 100).toFixed(1)}%`,
    `- **Files Audited**: ${tableRows.length}`,
    `- **Passing Files**: ${tableRows.length - failing.length}`,
    `- **Failing Files**: ${failing.length}`,
    `- **Status**: ${passed ? "✅ PASSED" : "❌ FAILED"}`,
  ].join("\n");

  if (strict && !passed) {
    throw new HarnessError(
      "INVALID_STATE",
      `Coverage threshold of ${(threshold * 100).toFixed(1)}% not met (${failing.length} files below threshold)`,
      failing.map((f) => `${f.file}: ${(f.lines * 100).toFixed(1)}% lines`),
    );
  }

  return {
    markdown,
    passed,
    threshold,
    total_files: tableRows.length,
    failing_count: failing.length,
    failing_files: failing,
  };
}
