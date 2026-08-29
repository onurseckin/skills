import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AntiMockMutationCheckOptions,
  DoctorCheckEngineResult,
  DoctorDiagnosticFinding,
} from "./types.ts";

export type { AntiMockMutationCheckOptions };

const EMPTY_TEST_BODY_REGEX =
  /(?:it|test)\s*\(\s*["'][^"']+["']\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/gu;

const TRIVIAL_ASSERTION_PATTERNS: readonly { readonly pattern: RegExp; readonly name: string }[] = [
  {
    pattern: /expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*true\s*\)/u,
    name: "expect(true).toBe(true)",
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

export function checkAntiMockMutation(
  options: AntiMockMutationCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  if (options.fileContents) {
    for (const [path, content] of Object.entries(options.fileContents)) {
      findings.push(...scanCodeForBannedMocks(path, content));
    }
    return {
      engine: "checkAntiMockMutation",
      passed: findings.length === 0,
      findings,
    };
  }

  if (options.targetFiles && options.targetFiles.length > 0) {
    for (const relPath of options.targetFiles) {
      const fullPath = options.repoRoot ? resolve(options.repoRoot, relPath) : resolve(relPath);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
            const content = readFileSync(fullPath, "utf-8");
            findings.push(...scanCodeForBannedMocks(relPath, content));
          }
        } catch {}
      }
    }
  }

  if (options.counterfactualRecords) {
    for (const rec of options.counterfactualRecords) {
      if (!rec.falsified) {
        findings.push({
          code: "ANTI_MOCK_COUNTERFACTUAL_FAILURE",
          severity: "ERROR",
          engine: "checkAntiMockMutation",
          message: `Counterfactual mutation test failed to falsify gate: ${rec.name} (${rec.targetPath})`,
          details: {
            checkId: rec.checkId,
            name: rec.name,
            targetPath: rec.targetPath,
            mutation: rec.mutation,
          },
        });
      }
    }
  }

  return {
    engine: "checkAntiMockMutation",
    passed: findings.length === 0,
    findings,
  };
}
