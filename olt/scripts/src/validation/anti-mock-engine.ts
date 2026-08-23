import type {
  AntiMockDiagnosticReport,
  AntiMockEngineConfig,
  AntiMockEvaluationInput,
  AssertionFloorOptions,
  AssertionFloorResult,
  AstLinterOptions,
  AstLinterResult,
  MutantRecord,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
} from "./anti-mock-types.ts";
import { checkAssertionFloor } from "./assertion-floor.ts";
import { lintTestAst } from "./ast-linter.ts";
import { generateMutants, runMutationGate } from "./mutation-gate.ts";

export function formatAntiMockReport(report: AntiMockDiagnosticReport): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("               🛡️ ANTI-MOCK AGP VALIDATION ENGINE REPORT");
  lines.push("================================================================================");

  const verdictIcon = report.passed ? "✅ PASSED" : "❌ FAILED";
  lines.push(` Overall Verdict: ${verdictIcon} (${report.totalViolationsCount} violation(s))`);
  lines.push(` Timestamp: ${report.timestamp}`);
  if (report.testFileName) {
    lines.push(` Test Target: ${report.testFileName}`);
  }
  if (report.implementationFileName) {
    lines.push(` Implementation Target: ${report.implementationFileName}`);
  }
  lines.push("");

  // Pillar 1 Summary
  const p1 = report.pillar1AstLinter;
  const p1Status = p1.passed ? "✅ PASSED" : "❌ FAILED";
  lines.push(` ┌── Pillar 1: AST Early-Return & Mock Tautology Linter ────────────────────┐`);
  lines.push(
    ` │ Status: ${p1Status} (${p1.violations.length} violation(s) across ${p1.totalTestsAnalyzed} test(s))`,
  );
  lines.push(` │ • Empty test functions: ${p1.emptyTestCount}`);
  lines.push(` │ • Trivial early returns: ${p1.trivialReturnCount}`);
  lines.push(` │ • Mock tautologies: ${p1.mockTautologyCount}`);
  lines.push(` │ • Trivial constant assertions: ${p1.trivialConstantCount}`);
  if (p1.violations.length > 0) {
    lines.push(` │`);
    for (const v of p1.violations) {
      lines.push(` │ ❌ [${v.rule}] Line ${v.line}:${v.column} in '${v.testName ?? "<unknown>"}'`);
      lines.push(` │    ${v.message}`);
    }
  }
  lines.push(` └──────────────────────────────────────────────────────────────────────────┘`);
  lines.push("");

  // Pillar 2 Summary
  const p2 = report.pillar2AssertionFloor;
  const p2Status = p2.passed ? "✅ PASSED" : "❌ FAILED";
  lines.push(` ┌── Pillar 2: Assertion Count Floor Enforcer ──────────────────────────────┐`);
  lines.push(
    ` │ Status: ${p2Status} (Total: ${p2.totalAssertions} assertion(s), Avg: ${p2.averageAssertionsPerTest}/test)`,
  );
  lines.push(` │ • Total tests evaluated: ${p2.totalTests}`);
  lines.push(` │ • Minimum floor per test: ${p2.minAssertionsPerTest}`);
  lines.push(` │ • Minimum floor per file: ${p2.minAssertionsPerFile}`);
  if (p2.violations.length > 0) {
    lines.push(` │`);
    for (const v of p2.violations) {
      lines.push(` │ ❌ [${v.rule}] Line ${v.line}:${v.column} in '${v.testName ?? "<file>"}'`);
      lines.push(` │    ${v.message}`);
    }
  }
  lines.push(` └──────────────────────────────────────────────────────────────────────────┘`);
  lines.push("");

  // Pillar 3 Summary
  lines.push(` ┌── Pillar 3: Mutation Gate Engine (Falsifiability Verification) ──────────┐`);
  if (report.pillar3MutationGate) {
    const p3 = report.pillar3MutationGate;
    const p3Status = p3.passed ? "✅ PASSED" : "❌ FAILED";
    lines.push(
      ` │ Status: ${p3Status} (Mutation Score: ${p3.mutationScore.toFixed(2)}% | ${p3.killedMutants}/${p3.totalMutants} Killed, ${p3.survivedMutants} Survived)`,
    );
    lines.push(` │ • Total mutants evaluated: ${p3.totalMutants}`);
    lines.push(` │ • Mutants killed (detected): ${p3.killedMutants}`);
    lines.push(` │ • Mutants survived (missed): ${p3.survivedMutants}`);
    lines.push(` │ • Mutant errors: ${p3.erroredMutants}`);
    if (p3.violations.length > 0) {
      lines.push(` │`);
      for (const v of p3.violations) {
        lines.push(` │ ❌ [${v.mutationType}] Line ${v.line}:${v.column} (Mutant: ${v.mutantId})`);
        lines.push(` │    ${v.message}`);
      }
    }
  } else {
    lines.push(` │ Status: ⚪ SKIPPED (No test runner or implementation source provided)   │`);
  }
  lines.push(` └──────────────────────────────────────────────────────────────────────────┘`);
  lines.push("================================================================================");

  return lines.join("\n");
}

export async function evaluateAntiMock(
  input: AntiMockEvaluationInput,
  config?: AntiMockEngineConfig,
): Promise<AntiMockDiagnosticReport> {
  const testFile =
    typeof input.testFileName === "string" && input.testFileName.length > 0
      ? input.testFileName
      : "test.ts";
  const implFile =
    typeof input.implementationFileName === "string" && input.implementationFileName.length > 0
      ? input.implementationFileName
      : typeof input.testFileName === "string" && input.testFileName.length > 0
        ? input.testFileName
        : "source.ts";

  const linterOpts: AstLinterOptions = {
    ...config?.linterOptions,
    ...input.options?.linterOptions,
    file: testFile,
  };

  const floorOpts: AssertionFloorOptions = {
    ...config?.floorOptions,
    ...input.options?.floorOptions,
    file: testFile,
  };

  const mutationOpts: MutationGateOptions = {
    ...config?.mutationOptions,
    ...input.options?.mutationOptions,
    file: implFile,
  };

  const pillar1 = lintTestAst(input.testSource, linterOpts);
  const pillar2 = checkAssertionFloor(input.testSource, floorOpts);

  let pillar3: MutationGateResult | undefined = undefined;
  if (input.testRunner) {
    const targetSource =
      input.implementationSource !== undefined ? input.implementationSource : input.testSource;
    pillar3 = await runMutationGate(targetSource, input.testRunner, mutationOpts);
  }

  const pillar3Passed = pillar3 !== undefined ? pillar3.passed : true;
  const passed = pillar1.passed && pillar2.passed && pillar3Passed;

  const totalViolationsCount =
    pillar1.violations.length +
    pillar2.violations.length +
    (pillar3 !== undefined ? pillar3.violations.length : 0);

  const report: AntiMockDiagnosticReport = {
    passed,
    timestamp: new Date().toISOString(),
    testFileName: input.testFileName,
    implementationFileName: input.implementationFileName,
    pillar1AstLinter: pillar1,
    pillar2AssertionFloor: pillar2,
    pillar3MutationGate: pillar3,
    totalViolationsCount,
    summary: "",
  };

  const summary = formatAntiMockReport(report);

  return {
    ...report,
    summary,
  };
}

export class AntiMockEngine {
  private readonly config: AntiMockEngineConfig;

  constructor(config?: AntiMockEngineConfig) {
    this.config = config !== undefined ? config : {};
  }

  public lintAst(sourceCode: string, fileName?: string): AstLinterResult {
    const resolvedName = typeof fileName === "string" && fileName.length > 0 ? fileName : "test.ts";
    return lintTestAst(sourceCode, {
      ...this.config.linterOptions,
      file: resolvedName,
    });
  }

  public enforceAssertionFloor(sourceCode: string, fileName?: string): AssertionFloorResult {
    const resolvedName = typeof fileName === "string" && fileName.length > 0 ? fileName : "test.ts";
    return checkAssertionFloor(sourceCode, {
      ...this.config.floorOptions,
      file: resolvedName,
    });
  }

  public generateMutants(sourceCode: string, options?: MutationGateOptions): MutantRecord[] {
    return generateMutants(sourceCode, {
      ...this.config.mutationOptions,
      ...options,
    });
  }

  public async runMutationGate(
    sourceCode: string,
    testRunner: MutationTestRunner,
    options?: MutationGateOptions,
  ): Promise<MutationGateResult> {
    return runMutationGate(sourceCode, testRunner, {
      ...this.config.mutationOptions,
      ...options,
    });
  }

  public async evaluate(input: AntiMockEvaluationInput): Promise<AntiMockDiagnosticReport> {
    return evaluateAntiMock(input, this.config);
  }

  public formatReport(report: AntiMockDiagnosticReport): string {
    return formatAntiMockReport(report);
  }
}
