import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AntiMockMutationCheckOptions,
  CounterfactualCheckRecord,
  DoctorCheckEngineResult,
  DoctorDiagnosticFinding,
} from "./types.ts";

export type { AntiMockMutationCheckOptions, CounterfactualCheckRecord };

const EMPTY_TEST_BODY_REGEX =
  /(?:it|test)\s*\(\s*["'][^"']+["']\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/gu;

function isTrivialPositiveAssertion(line: string): {
  readonly isTrivial: boolean;
  readonly name: string;
} {
  // Negative matchers (.not.toBe, .not.toEqual) represent inequality proofs and must not be flagged
  if (/\.not\s*\.\s*(?:toBe|toEqual)/u.test(line)) {
    return { isTrivial: false, name: "" };
  }

  if (/expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*true\s*\)/u.test(line)) {
    return { isTrivial: true, name: "expect(true).toBe(true)" };
  }
  if (/expect\s*\(\s*false\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*false\s*\)/u.test(line)) {
    return { isTrivial: true, name: "expect(false).toBe(false)" };
  }
  if (/expect\s*\(\s*1\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*1\s*\)/u.test(line)) {
    return { isTrivial: true, name: "expect(1).toBe(1)" };
  }
  if (/expect\s*\(\s*0\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*0\s*\)/u.test(line)) {
    return { isTrivial: true, name: "expect(0).toBe(0)" };
  }

  const literalMatch = line.match(
    /expect\s*\(\s*(["'])([^"']*)\1\s*\)\s*\.\s*(?:toBe|toEqual)\s*\(\s*(["'])([^"']*)\3\s*\)/u,
  );
  if (literalMatch && literalMatch[2] === literalMatch[4]) {
    return {
      isTrivial: true,
      name: `expect('${literalMatch[2]}').toBe('${literalMatch[4]}')`,
    };
  }

  return { isTrivial: false, name: "" };
}

function scanCodeForBannedMocks(filePath: string, content: string): DoctorDiagnosticFinding[] {
  const findings: DoctorDiagnosticFinding[] = [];
  const normalizedPath = String(filePath);

  const emptyMatches = content.matchAll(EMPTY_TEST_BODY_REGEX);
  for (const match of emptyMatches) {
    findings.push({
      code: "ANTI_MOCK_EMPTY_TEST_BODY",
      severity: "ERROR",
      engine: "checkAntiMockMutation",
      message: `Banned mock defect in ${normalizedPath}: Empty test body found ("${match[0].slice(0, 80)}")`,
      details: { filePath: normalizedPath, snippet: match[0] },
    });
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const { isTrivial, name } = isTrivialPositiveAssertion(trimmed);
    if (isTrivial) {
      findings.push({
        code: "ANTI_MOCK_TRIVIAL_ASSERTION",
        severity: "ERROR",
        engine: "checkAntiMockMutation",
        message: `Banned mock defect in ${normalizedPath}:${i + 1}: Trivial assertion without system verification: ${name}`,
        details: { filePath: normalizedPath, lineNumber: i + 1, snippet: trimmed },
      });
    }
  }

  return findings;
}

export function checkAntiMockMutation(
  options: AntiMockMutationCheckOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  if (options.fileContents) {
    for (const [p, content] of Object.entries(options.fileContents)) {
      findings.push(...scanCodeForBannedMocks(String(p), String(content)));
    }
    return {
      engine: "checkAntiMockMutation",
      passed: findings.length === 0,
      findings,
    };
  }

  const candidatePaths: string[] = [];
  if (options.targetFiles) candidatePaths.push(...options.targetFiles);
  if (options.targetPaths) candidatePaths.push(...options.targetPaths);
  if (options.testFiles) candidatePaths.push(...options.testFiles);
  if (options.sourceFiles) candidatePaths.push(...options.sourceFiles);

  const uniquePaths = Array.from(new Set(candidatePaths));
  if (uniquePaths.length > 0) {
    for (const p of uniquePaths) {
      const relPath = String(p);
      const fullPath = options.repoRoot
        ? resolve(String(options.repoRoot), relPath)
        : resolve(relPath);
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
          code: "COUNTERFACTUAL_NOT_FALSIFIABLE",
          severity: "ERROR",
          engine: "checkAntiMockMutation",
          message: `Counterfactual mutation test failed to falsify gate: ${String(rec.name)} (${String(rec.targetPath)})`,
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
