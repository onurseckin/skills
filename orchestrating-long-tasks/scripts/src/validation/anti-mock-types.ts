export type AstLinterRule =
  | "empty_test_function"
  | "trivial_early_return"
  | "mock_tautology"
  | "trivial_constant_assertion";

export interface AstLinterViolation {
  readonly rule: AstLinterRule;
  readonly message: string;
  readonly file?: string | undefined;
  readonly line: number;
  readonly column: number;
  readonly testName?: string | undefined;
  readonly snippet?: string | undefined;
}

export interface AstLinterOptions {
  readonly detectEmptyTests?: boolean | undefined;
  readonly detectTrivialReturns?: boolean | undefined;
  readonly detectMockTautologies?: boolean | undefined;
  readonly detectTrivialConstants?: boolean | undefined;
  readonly file?: string | undefined;
}

export interface AstLinterResult {
  readonly passed: boolean;
  readonly totalTestsAnalyzed: number;
  readonly violations: readonly AstLinterViolation[];
  readonly emptyTestCount: number;
  readonly trivialReturnCount: number;
  readonly mockTautologyCount: number;
  readonly trivialConstantCount: number;
}

export type AssertionFloorRule =
  | "zero_assertions"
  | "sub_floor_assertions"
  | "sub_floor_file_assertions";

export interface AssertionFloorViolation {
  readonly rule: AssertionFloorRule;
  readonly message: string;
  readonly file?: string | undefined;
  readonly line: number;
  readonly column: number;
  readonly testName?: string | undefined;
  readonly actualCount: number;
  readonly expectedMin: number;
}

export interface TestAssertionSummary {
  readonly testName: string;
  readonly assertionCount: number;
  readonly line: number;
  readonly column: number;
  readonly passed: boolean;
}

export interface AssertionFloorOptions {
  readonly minAssertionsPerTest?: number | undefined;
  readonly minAssertionsPerFile?: number | undefined;
  readonly customAssertionIdentifiers?: readonly string[] | undefined;
  readonly file?: string | undefined;
}

export interface AssertionFloorResult {
  readonly passed: boolean;
  readonly totalTests: number;
  readonly totalAssertions: number;
  readonly minAssertionsPerTest: number;
  readonly minAssertionsPerFile: number;
  readonly tests: readonly TestAssertionSummary[];
  readonly violations: readonly AssertionFloorViolation[];
  readonly averageAssertionsPerTest: number;
}

export type MutationType =
  | "invert_boolean"
  | "strip_function_body"
  | "flip_return_value"
  | "arithmetic_mutation"
  | "string_literal_mutation"
  | "comparison_mutation"
  | "logical_operator_mutation"
  | "statement_removal";

export interface MutantRecord {
  readonly id: string;
  readonly mutationType: MutationType;
  readonly description: string;
  readonly line: number;
  readonly column: number;
  readonly startPosition: number;
  readonly endPosition: number;
  readonly originalText: string;
  readonly mutatedText: string;
  readonly mutatedSource: string;
}

export type MutantStatus = "killed" | "survived" | "error";

export interface MutantExecutionResult {
  readonly mutant: MutantRecord;
  readonly status: MutantStatus;
  readonly details?: string | undefined;
  readonly durationMs?: number | undefined;
}

export interface MutationViolation {
  readonly mutantId: string;
  readonly mutationType: MutationType;
  readonly line: number;
  readonly column: number;
  readonly originalSnippet: string;
  readonly mutatedSnippet: string;
  readonly message: string;
}

export interface MutationTestRunOutcome {
  readonly passed: boolean;
  readonly exitCode?: number | undefined;
  readonly error?: string | undefined;
}

export type MutationTestRunner = (
  mutatedSource: string,
  mutant: MutantRecord,
) => Promise<MutationTestRunOutcome> | MutationTestRunOutcome;

export interface MutationGateOptions {
  readonly minMutationScore?: number | undefined;
  readonly maxMutants?: number | undefined;
  readonly mutationTypes?: readonly MutationType[] | undefined;
  readonly file?: string | undefined;
  readonly strictZeroSurvival?: boolean | undefined;
}

export interface MutationGateResult {
  readonly passed: boolean;
  readonly totalMutants: number;
  readonly killedMutants: number;
  readonly survivedMutants: number;
  readonly erroredMutants: number;
  readonly mutationScore: number;
  readonly minMutationScore: number;
  readonly mutantResults: readonly MutantExecutionResult[];
  readonly violations: readonly MutationViolation[];
}

export interface AntiMockEngineConfig {
  readonly linterOptions?: AstLinterOptions | undefined;
  readonly floorOptions?: AssertionFloorOptions | undefined;
  readonly mutationOptions?: MutationGateOptions | undefined;
}

export interface AntiMockEvaluationInput {
  readonly testSource: string;
  readonly implementationSource?: string | undefined;
  readonly testFileName?: string | undefined;
  readonly implementationFileName?: string | undefined;
  readonly testRunner?: MutationTestRunner | undefined;
  readonly options?: AntiMockEngineConfig | undefined;
}

export interface AntiMockDiagnosticReport {
  readonly passed: boolean;
  readonly timestamp: string;
  readonly testFileName?: string | undefined;
  readonly implementationFileName?: string | undefined;
  readonly pillar1AstLinter: AstLinterResult;
  readonly pillar2AssertionFloor: AssertionFloorResult;
  readonly pillar3MutationGate?: MutationGateResult | undefined;
  readonly totalViolationsCount: number;
  readonly summary: string;
}
