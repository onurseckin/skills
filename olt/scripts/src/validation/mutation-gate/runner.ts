import type {
  MutantExecutionResult,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
  MutationViolation,
} from "./types.ts";
import { generateMutants } from "./ast-mutators.ts";

export async function runMutationGate(
  sourceCode: string,
  testRunner: MutationTestRunner,
  options?: MutationGateOptions,
): Promise<MutationGateResult> {
  const minScore = typeof options?.minMutationScore === "number" ? options.minMutationScore : 100;
  const strictZeroSurvival =
    options?.strictZeroSurvival !== undefined ? options.strictZeroSurvival : true;
  const mutants = generateMutants(sourceCode, options);

  if (mutants.length === 0) {
    return {
      passed: true,
      totalMutants: 0,
      killedMutants: 0,
      survivedMutants: 0,
      erroredMutants: 0,
      mutationScore: 100,
      minMutationScore: minScore,
      mutantResults: [],
      violations: [],
    };
  }

  const results: MutantExecutionResult[] = [];
  const violations: MutationViolation[] = [];
  let killed = 0;
  let survived = 0;
  let errored = 0;

  for (const mutant of mutants) {
    const startTime = Date.now();
    try {
      const outcome = await testRunner(mutant.mutatedSource, mutant);
      const durationMs = Date.now() - startTime;

      // In mutation testing:
      // If tests fail (passed: false, exitCode != 0), mutant was KILLED (success!)
      // If tests pass (passed: true, exitCode == 0), mutant SURVIVED (failure - test suite missed it!)
      if (outcome.passed === false || (outcome.exitCode !== undefined && outcome.exitCode !== 0)) {
        killed++;
        const errDetails =
          typeof outcome.error === "string" && outcome.error.length > 0
            ? outcome.error
            : "Test suite detected mutation and failed as expected.";
        results.push({
          mutant,
          status: "killed",
          details: errDetails,
          durationMs,
        });
      } else {
        survived++;
        results.push({
          mutant,
          status: "survived",
          details: "Test suite passed unexpectedly despite intentional defect.",
          durationMs,
        });
        violations.push({
          mutantId: mutant.id,
          mutationType: mutant.mutationType,
          line: mutant.line,
          column: mutant.column,
          originalSnippet: mutant.originalText,
          mutatedSnippet: mutant.mutatedText,
          message: `Mutant '${mutant.id}' (${mutant.description}) survived: test suite passed without detecting intentional defect at line ${mutant.line}:${mutant.column}.`,
        });
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Syntax errors or runner execution errors are recorded as errored
      errored++;
      results.push({
        mutant,
        status: "error",
        details: `Mutation execution error: ${errorMsg}`,
        durationMs,
      });
    }
  }

  const mutationScore = Number(((killed / mutants.length) * 100).toFixed(2));
  const passed =
    mutationScore >= minScore && (!strictZeroSurvival || survived === 0) && errored === 0;

  return {
    passed,
    totalMutants: mutants.length,
    killedMutants: killed,
    survivedMutants: survived,
    erroredMutants: errored,
    mutationScore,
    minMutationScore: minScore,
    mutantResults: results,
    violations,
  };
}
