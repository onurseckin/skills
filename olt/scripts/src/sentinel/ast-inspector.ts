import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SentinelViolation } from "./types.ts";

export interface FileInspectionResult {
  readonly filePath: string;
  readonly lineCount: number;
  readonly violations: readonly SentinelViolation[];
}

export function inspectPhysicalLines(
  content: string,
  filePath: string,
): readonly SentinelViolation[] {
  const lines = content.split("\n");
  const lineCount = lines.length;
  if (lineCount > 300) {
    return [
      {
        code: "LINE_BUDGET_EXCEEDED",
        severity: "CRITICAL",
        message: `Physical line count (${lineCount}) exceeds strict budget of 400 lines.`,
        target_file: filePath,
        remediation_cmd: `Decompose ${filePath} into smaller focused modules.`,
        documentation_ref: "AGENTS.md#rule-2",
      },
    ];
  }
  return [];
}

export function inspectAstPurity(content: string, filePath: string): readonly SentinelViolation[] {
  const violations: SentinelViolation[] = [];

  const suppressionMatches = [
    { pattern: /@ts-ignore/, token: "@ts-ignore" },
    { pattern: /@ts-expect-error/, token: "@ts-expect-error" },
    { pattern: /@ts-nocheck/, token: "@ts-nocheck" },
  ];

  for (const item of suppressionMatches) {
    if (item.pattern.test(content)) {
      violations.push({
        code: "AST_SUPPRESSION_DETECTED",
        severity: "CRITICAL",
        message: `Compiler suppression '${item.token}' detected; zero suppressions permitted.`,
        target_file: filePath,
        remediation_cmd: `Remove ${item.token} and fix types properly.`,
        documentation_ref: "AGENTS.md#rule-1",
      });
    }
  }

  // Check for TypeScript any escapes
  const anyMatches = [
    { pattern: /:\s*any\b/, token: ": any" },
    { pattern: /\bas\s+any\b/, token: "as any" },
    { pattern: /<any>/, token: "<any>" },
  ];

  for (const item of anyMatches) {
    if (item.pattern.test(content)) {
      violations.push({
        code: "ZERO_ANY_VIOLATION",
        severity: "CRITICAL",
        message: `Untyped escape hatch '${item.token}' detected; zero any permitted.`,
        target_file: filePath,
        remediation_cmd: `Replace '${item.token}' with exact types or unknown with type guards.`,
        documentation_ref: "AGENTS.md#rule-1",
      });
    }
  }

  // Check for wildcard export: export * from
  if (/export\s+\*\s+from/.test(content)) {
    violations.push({
      code: "WILDCARD_EXPORT_PROHIBITED",
      severity: "CRITICAL",
      message: "Wildcard 'export *' prohibited; use explicit named facade exports.",
      target_file: filePath,
      remediation_cmd: "Export named symbols explicitly.",
      documentation_ref: "AGENTS.md#rule-3",
    });
  }

  // Check for default export: export default
  if (/export\s+default\s+/.test(content)) {
    violations.push({
      code: "DEFAULT_EXPORT_PROHIBITED",
      severity: "CRITICAL",
      message: "Default export detected; named exports only permitted.",
      target_file: filePath,
      remediation_cmd: "Convert default export to named export.",
      documentation_ref: "AGENTS.md#rule-3",
    });
  }

  return violations;
}

export function inspectDirectoryFanout(dirPath: string): readonly SentinelViolation[] {
  if (!existsSync(dirPath)) return [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const fileEntries = entries.filter((e) => e.isFile() && !e.name.startsWith("."));
    if (fileEntries.length > 10) {
      return [
        {
          code: "DIRECTORY_FANOUT_EXCEEDED",
          severity: "WARN",
          message: `Directory '${dirPath}' contains ${fileEntries.length} files (maximum budget is 10 files).`,
          remediation_cmd: `Group related modules into subdirectories with an index.ts facade.`,
          documentation_ref: "AGENTS.md#rule-2",
        },
      ];
    }
  } catch {}
  return [];
}

export function inspectSourceFile(filePath: string): FileInspectionResult {
  if (!existsSync(filePath)) {
    return { filePath, lineCount: 0, violations: [] };
  }

  const content = readFileSync(filePath, "utf-8");
  const lineViolations = inspectPhysicalLines(content, filePath);
  const astViolations = inspectAstPurity(content, filePath);
  const fanoutViolations = inspectDirectoryFanout(dirname(filePath));

  const allViolations = [...lineViolations, ...astViolations, ...fanoutViolations];
  return {
    filePath,
    lineCount: content.split("\n").length,
    violations: allViolations,
  };
}
