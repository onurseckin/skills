import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface AstPurityCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly fileContents?: Readonly<Record<string, string>> | undefined;
}

const BANNED_SUPPRESSION_PATTERNS: readonly { readonly pattern: RegExp; readonly name: string }[] = [
  { pattern: /@ts-ignore/u, name: "@ts-ignore" },
  { pattern: /@ts-expect-error/u, name: "@ts-expect-error" },
  { pattern: /\bas\s+any\b/u, name: "as any" },
  { pattern: /<\s*any\s*>/u, name: "<any>" },
  { pattern: /:\s*any(?=[;\s,)=>[\]{}|&]|$)/u, name: ": any" },
  { pattern: /\bany\[\]/u, name: "any[]" },
  { pattern: /\bArray<\s*any\s*>/u, name: "Array<any>" },
  { pattern: /\bPromise<\s*any\s*>/u, name: "Promise<any>" },
];

/**
 * Scans lines of TypeScript code for banned suppressions and 'any' usages.
 */
function scanContentForPurity(filePath: string, content: string): DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const { pattern, name } of BANNED_SUPPRESSION_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          code: "AST_PURITY_VIOLATION",
          severity: "ERROR",
          engine: "checkAstPurity",
          message: `AST purity invariant violation in ${filePath}:${i + 1}: Found banned ${name} usage ("${trimmed}")`,
          details: {
            filePath,
            lineNumber: i + 1,
            violationType: name,
            lineContent: trimmed,
          },
        });
      }
    }
  }

  return findings;
}

/**
 * Engine 2: checkAstPurity
 * Scans TypeScript files for @ts-ignore, @ts-expect-error, : any, as any, <any>, etc.
 */
export function checkAstPurity(options: AstPurityCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  // 1. If explicit fileContents provided
  if (options.fileContents) {
    for (const [path, content] of Object.entries(options.fileContents)) {
      findings.push(...scanContentForPurity(path, content));
    }
    return {
      engine: "checkAstPurity",
      passed: findings.length === 0,
      findings,
    };
  }

  // 2. If writeScope provided
  if (options.writeScope && options.writeScope.length > 0) {
    for (const relPath of options.writeScope) {
      const fullPath = options.repoRoot ? resolve(options.repoRoot, relPath) : resolve(relPath);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
            const content = readFileSync(fullPath, "utf-8");
            findings.push(...scanContentForPurity(relPath, content));
          }
        } catch {
          // File read error ignored
        }
      }
    }
  }

  return {
    engine: "checkAstPurity",
    passed: findings.length === 0,
    findings,
  };
}
