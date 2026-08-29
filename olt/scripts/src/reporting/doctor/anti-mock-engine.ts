import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface CounterfactualCheckRecord {
  readonly name?: string | undefined;
  readonly passed: boolean;
  readonly falsified: boolean;
  readonly baselinePassed?: boolean | undefined;
  readonly message?: string | undefined;
}

export interface AntiMockMutationCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly targetPaths?: readonly string[] | undefined;
  readonly fileContents?: Readonly<Record<string, string>> | undefined;
  readonly counterfactualRecords?: readonly CounterfactualCheckRecord[] | undefined;
}

const EMPTY_TEST_BODY_REGEX =
  /(?:test|it)\s*\(\s*["'`][^"'`]+["'`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/gu;

const TRIVIAL_ASSERTION_PATTERNS: readonly { readonly pattern: RegExp; readonly name: string }[] = [
  {
    pattern: /expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*true\s*\)/u,
    name: "expect(true).toBe(true)",
  },
  {
    pattern: /expect\s*\(\s*true\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)/u,
    name: "expect(true).toBeTruthy()",
  },
  {
    pattern: /expect\s*\(\s*false\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*false\s*\)/u,
    name: "expect(false).toBe(false)",
  },
  {
    pattern: /expect\s*\(\s*1\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*1\s*\)/u,
    name: "expect(1).toBe(1)",
  },
  {
    pattern: /expect\s*\(\s*0\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*0\s*\)/u,
    name: "expect(0).toBe(0)",
  },
  {
    pattern:
      /expect\s*\(\s*["'][^"']*["']\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*["'][^"']*["']\s*\)/u,
    name: "expect('literal').toBe('literal')",
  },
];

function scanCodeForBannedMocks(filePath: string, content: string): DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];

  // 1. Scan for empty test bodies
  const emptyMatches = content.matchAll(EMPTY_TEST_BODY_REGEX);
  for (const match of emptyMatches) {
    findings.push({
      code: "ANTI_MOCK_EMPTY_TEST_BODY",
      severity: "ERROR",
      engine: "checkAntiMockMutation",
      message: `Banned mock defect in ${filePath}: Empty test body found ("${match[0].slice(0, 80)}")`,
      details: { filePath, snippet: match[0] },
    });
  }

  // 2. Scan lines for trivial true assertions
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    for (const { pattern, name } of TRIVIAL_ASSERTION_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({
          code: "ANTI_MOCK_TRIVIAL_ASSERTION",
          severity: "ERROR",
          engine: "checkAntiMockMutation",
          message: `Banned mock defect in ${filePath}:${i + 1}: Trivial assertion without system verification: ${name}`,
          details: { filePath, lineNumber: i + 1, snippet: trimmed },
        });
      }
    }
  }

  return findings;
}

/**
 * Engine 3: checkAntiMockMutation
 * Validates against banned mocking patterns and counterfactual falsifiability.
 */
export function checkAntiMockMutation(
  options: AntiMockMutationCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  // 1. Scan in-memory file contents if provided
  if (options.fileContents) {
    for (const [path, content] of Object.entries(options.fileContents)) {
      findings.push(...scanCodeForBannedMocks(path, content));
    }
  }

  // 2. Scan target files if provided
  if (options.targetPaths) {
    for (const targetPath of options.targetPaths) {
      const fullPath = options.repoRoot
        ? resolve(options.repoRoot, targetPath)
        : resolve(targetPath);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && (fullPath.endsWith(".test.ts") || fullPath.endsWith(".spec.ts"))) {
            const content = readFileSync(fullPath, "utf-8");
            findings.push(...scanCodeForBannedMocks(targetPath, content));
          }
        } catch {
          // File read error ignored
        }
      }
    }
  }

  // 3. Check counterfactual records
  if (options.counterfactualRecords) {
    for (const record of options.counterfactualRecords) {
      if (record.baselinePassed === false) {
        findings.push({
          code: "COUNTERFACTUAL_BASELINE_FAILED",
          severity: "ERROR",
          engine: "checkAntiMockMutation",
          message: `Counterfactual baseline failed before mutation: ${record.name ?? "unnamed test"}`,
          details: { record },
        });
      } else if (!record.falsified && record.passed) {
        findings.push({
          code: "COUNTERFACTUAL_NOT_FALSIFIABLE",
          severity: "ERROR",
          engine: "checkAntiMockMutation",
          message: `Counterfactual falsifiability failure: Test still passed despite injected mutation: ${record.name ?? "unnamed test"}`,
          details: { record },
        });
      }
    }
  }

  return {
    engine: "checkAntiMockMutation",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
