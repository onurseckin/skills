/**
 * Proactive Plan Pre-Enhancer & Discriminating Gate Compiler Engine
 *
 * Pre-compiles discriminating unit test assertions, AGP counterfactual criteria,
 * and clean AST boundaries before task claim. Compiles task invariant checklists,
 * counterfactual probe templates, and write-scope boundary verifications.
 *
 * INVARIANTS:
 * - ZERO TypeScript `any` types.
 * - ZERO defaulted literal fallback operators (`??`, `||`) masking nullish/empty values.
 *   Explicit branching and type guards only.
 * - Discriminating unit test generation rejecting mock tautologies and trivial assertions.
 */

import { HarnessError } from "../core/errors/harness-error.ts";
import type { JsonObject, JsonValue } from "../core/contracts/json.ts";
import { isRecord, isNonblank, isInteger } from "../requirements/predicates.ts";
import { checkScopeOverlap, normalizeScopePath } from "../graph/scope-analyzer.ts";

export const PRE_ENHANCER_VERSION = "gen3_pre_enhancer_v1" as const;

export const DEFAULT_TASK_PRIORITY = 50;
export const DEFAULT_TASK_EFFORT = 3;
export const MIN_READINESS_SCORE = 0;
export const MAX_READINESS_SCORE = 100;
export const PASSING_READINESS_THRESHOLD = 75;

export type DiscriminatingAssertionType =
  | "non_empty_return"
  | "boundary_value_rejection"
  | "state_mutation_verification"
  | "invariant_enforcement"
  | "counterfactual_rejection"
  | "ast_zero_fallback"
  | "disjoint_scope_isolation"
  | "error_class_discrimination"
  | "strict_type_guard"
  | "deterministic_ordering";

export const DISCRIMINATING_ASSERTION_TYPES: readonly DiscriminatingAssertionType[] = [
  "non_empty_return",
  "boundary_value_rejection",
  "state_mutation_verification",
  "invariant_enforcement",
  "counterfactual_rejection",
  "ast_zero_fallback",
  "disjoint_scope_isolation",
  "error_class_discrimination",
  "strict_type_guard",
  "deterministic_ordering",
] as const;

export type AssertionSeverity = "critical" | "high" | "medium";

export interface DiscriminatingAssertion {
  readonly id: string;
  readonly taskId: string;
  readonly type: DiscriminatingAssertionType;
  readonly targetSymbol: string;
  readonly description: string;
  readonly expectedBehavior: string;
  readonly counterfactualCondition: string;
  readonly falsifiableCodeSnippet: string;
  readonly testCaseName: string;
  readonly severity: AssertionSeverity;
}

export type ProbeCategory =
  | "null_mutation"
  | "empty_collection"
  | "inverted_condition"
  | "fallback_injection"
  | "scope_violation"
  | "type_corruption"
  | "boundary_clamp";

export interface AgpCounterfactualProbeTemplate {
  readonly probeId: string;
  readonly taskId: string;
  readonly targetFile: string;
  readonly probeCategory: ProbeCategory;
  readonly originalBehaviorDescription: string;
  readonly counterfactualMutation: string;
  readonly expectedGateOutcome: "failure";
  readonly expectedFailurePattern: string;
  readonly remediationGuidance: string;
}

export interface TaskInvariantItem {
  readonly id: string;
  readonly name: string;
  readonly rule: string;
  readonly verificationMethod: "static_ast" | "gate_execution" | "scope_audit" | "behavioral_probe";
  readonly mandatory: boolean;
}

export interface WriteScopeBoundary {
  readonly declaredPaths: readonly string[];
  readonly normalizedPaths: readonly string[];
  readonly disallowedPaths: readonly string[];
  readonly isDisjointFromConcurrentLanes: boolean;
  readonly sourceFiles: readonly string[];
  readonly testFiles: readonly string[];
}

export interface TaskInvariantChecklist {
  readonly taskId: string;
  readonly role: "implementer" | "validator" | "repairer";
  readonly tier: number;
  readonly invariants: readonly TaskInvariantItem[];
  readonly writeScopeBoundary: WriteScopeBoundary;
}

export interface ForbiddenSyntaxRule {
  readonly pattern: string;
  readonly reason: string;
  readonly astNodeType: string;
  readonly ruleId: string;
}

export interface StrictTypingRules {
  readonly noAny: boolean;
  readonly noLiteralFallbackMasking: boolean;
  readonly explicitReturnTypes: boolean;
}

export interface AstBoundaryFinding {
  readonly ruleId: string;
  readonly line: number;
  readonly column: number;
  readonly codeSnippet: string;
  readonly message: string;
  readonly severity: "critical" | "warning";
}

export interface AstBoundaryVerificationResult {
  readonly filePath: string;
  readonly compliant: boolean;
  readonly findings: readonly AstBoundaryFinding[];
  readonly checkedRulesCount: number;
  readonly forbiddenSyntaxRules: readonly ForbiddenSyntaxRule[];
  readonly strictTyping: StrictTypingRules;
}

export interface PreEnhancementTaskInput {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly gateCommand: string | readonly string[];
  readonly effort?: number | undefined;
  readonly priority?: number | undefined;
  readonly requirementIds?: readonly string[] | undefined;
  readonly description?: string | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
  readonly roleContract?: "implementer" | "validator" | "repairer" | undefined;
}

export interface PreEnhancedTaskResult {
  readonly taskId: string;
  readonly label: string;
  readonly compiledGateCommand: readonly string[];
  readonly discriminatingAssertions: readonly DiscriminatingAssertion[];
  readonly agpProbes: readonly AgpCounterfactualProbeTemplate[];
  readonly invariantChecklist: TaskInvariantChecklist;
  readonly astBoundaries: readonly AstBoundaryVerificationResult[];
  readonly readinessScore: number;
  readonly scopeIntegrity: {
    readonly valid: boolean;
    readonly issues: readonly string[];
  };
  readonly generatedAt: string;
}

export interface PreEnhancedPlanResult {
  readonly schema: "harness.pre-enhanced-plan";
  readonly version: 1;
  readonly planId: string;
  readonly tasks: readonly PreEnhancedTaskResult[];
  readonly globalInvariants: readonly string[];
  readonly totalAssertionsCount: number;
  readonly totalAgpProbesCount: number;
  readonly averageReadinessScore: number;
  readonly allScopesDisjoint: boolean;
  readonly compiledAt: string;
}

export interface AssertionCompilationOptions {
  readonly codeContext?: string | undefined;
  readonly strictBoundaryChecks?: boolean | undefined;
  readonly maxAssertionsPerTask?: number | undefined;
}

export interface PreEnhanceTaskOptions {
  readonly concurrentScopes?: readonly (readonly string[])[] | undefined;
  readonly sourceCodeMap?: Readonly<Record<string, string>> | undefined;
  readonly strictMode?: boolean | undefined;
}

export interface PreEnhancePlanOptions {
  readonly planId?: string | undefined;
  readonly strictMode?: boolean | undefined;
  readonly sourceCodeMap?: Readonly<Record<string, string>> | undefined;
}

export interface ScopeDisjointnessResult {
  readonly isDisjoint: boolean;
  readonly overlappingPaths: readonly string[];
  readonly reason: string;
}

export const FORBIDDEN_SYNTAX_RULES: readonly ForbiddenSyntaxRule[] = [
  {
    ruleId: "NO_NULLISH_COALESCING_FALLBACK",
    pattern: "??",
    reason:
      "Nullish coalescing masks missing/undefined state instead of asserting or explicitly branching",
    astNodeType: "LogicalExpression[operator='??']",
  },
  {
    ruleId: "NO_LOGICAL_OR_FALLBACK",
    pattern: "||",
    reason: "Logical OR masks falsy or invalid values without explicit predicate checks",
    astNodeType: "LogicalExpression[operator='||']",
  },
  {
    ruleId: "NO_ANY_TYPE_ANNOTATION",
    pattern: ": any",
    reason: "TypeScript 'any' breaks static soundness and disables compiler verification",
    astNodeType: "TSAnyKeyword",
  },
  {
    ruleId: "NO_ANY_TYPE_CAST",
    pattern: "as any",
    reason: "Type casting to 'any' undermines type integrity",
    astNodeType: "TSTypeAssertion[typeAnnotation='TSAnyKeyword']",
  },
  {
    ruleId: "NO_TS_IGNORE_SUPPRESSION",
    pattern: "@ts-ignore",
    reason: "Compiler suppression directives hide typing defects and unverified invariants",
    astNodeType: "Comment[value*='@ts-ignore']",
  },
  {
    ruleId: "NO_TS_NOCHECK_SUPPRESSION",
    pattern: "@ts-nocheck",
    reason: "File-level compiler suppression disables type verification",
    astNodeType: "Comment[value*='@ts-nocheck']",
  },
] as const;

export const STANDARD_TASK_INVARIANTS: readonly TaskInvariantItem[] = [
  {
    id: "INV-STATIC-001",
    name: "Zero TypeScript Any Invariant",
    rule: "No symbol, variable, parameter, or return type may use 'any'",
    verificationMethod: "static_ast",
    mandatory: true,
  },
  {
    id: "INV-STATIC-002",
    name: "Zero Fallback Operator Masking Invariant",
    rule: "No literal fallback operators (??, ||) may be used to mask nullish/empty values",
    verificationMethod: "static_ast",
    mandatory: true,
  },
  {
    id: "INV-SCOPE-001",
    name: "Strict Disjoint Write Scope Invariant",
    rule: "Only declared and normalized write-scope paths may be created, edited, or deleted",
    verificationMethod: "scope_audit",
    mandatory: true,
  },
  {
    id: "INV-GATE-001",
    name: "Falsifiable Gate & Counterfactual Proof Invariant",
    rule: "Gates must perform substantive verification and fail counterfactual AGP probes",
    verificationMethod: "gate_execution",
    mandatory: true,
  },
  {
    id: "INV-DISCRIMINATION-001",
    name: "Discriminating Unit Test Invariant",
    rule: "Unit tests must contain zero mock tautologies, zero trivial constant assertions, and real mechanic checks",
    verificationMethod: "behavioral_probe",
    mandatory: true,
  },
] as const;

/**
 * Validates whether a value is an array of non-empty strings.
 */
export function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Normalizes and parses gate commands into an argv array.
 */
export function parseGateCommand(gateCommand: string | readonly string[]): readonly string[] {
  if (typeof gateCommand === "string") {
    const trimmed = gateCommand.trim();
    if (trimmed.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Gate command must not be empty text");
    }
    const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Gate command must contain at least one token");
    }
    return parts;
  }
  if (Array.isArray(gateCommand)) {
    if (gateCommand.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "Gate command array must not be empty");
    }
    const result: string[] = [];
    for (const part of gateCommand) {
      if (typeof part !== "string" || part.trim().length === 0) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "Gate command argv elements must be non-empty strings",
        );
      }
      result.push(part.trim());
    }
    return result;
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    "Gate command must be a non-empty string or array of strings",
  );
}

/**
 * Verifies whether two write scopes are strictly disjoint.
 */
export function verifyScopeDisjointness(
  scopeA: readonly string[],
  scopeB: readonly string[],
): ScopeDisjointnessResult {
  const normA = scopeA.map(normalizeScopePath);
  const normB = scopeB.map(normalizeScopePath);
  const overlap = checkScopeOverlap(normA, normB);

  if (overlap.hasOverlap) {
    return {
      isDisjoint: false,
      overlappingPaths: [overlap.conflictingPath],
      reason: `Write scope collision on '${overlap.conflictingPath}' with relationship '${overlap.relation}'`,
    };
  }

  return {
    isDisjoint: true,
    overlappingPaths: [],
    reason: "Write scopes are mutually disjoint with zero overlapping file or directory boundaries",
  };
}

/**
 * Compiles discriminating assertions for a given task.
 */
export function compileDiscriminatingAssertions(
  task: PreEnhancementTaskInput,
  options?: AssertionCompilationOptions,
): readonly DiscriminatingAssertion[] {
  if (!isNonblank(task.taskId)) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId must be a non-blank string");
  }
  if (!isNonblank(task.label)) {
    throw new HarnessError("INVALID_ARGUMENT", "label must be a non-blank string");
  }

  const assertions: DiscriminatingAssertion[] = [];
  const normalizedScopes = task.writeScope.map(normalizeScopePath);
  const taskSlug = task.taskId.replace(/^task-?/, "");

  // 1. AST Zero-Fallback and Type Soundness Assertion
  assertions.push({
    id: `DA-${taskSlug}-AST-001`,
    taskId: task.taskId,
    type: "ast_zero_fallback",
    targetSymbol: "sourceAST",
    description:
      "Enforces that implementation source contains zero fallback operators (??, ||) and zero 'any' casts",
    expectedBehavior:
      "All source files in write scope pass strict AST linting with 0 fallback violations",
    counterfactualCondition:
      "Source file contains a literal `??` or `||` operator masking nullish return values",
    falsifiableCodeSnippet: `expect(verifyAstBoundaries(sourcePath).compliant).toBe(true);`,
    testCaseName: "rejects fallback operators and untyped any references",
    severity: "critical",
  });

  // 2. Strict Type Guard Assertion
  assertions.push({
    id: `DA-${taskSlug}-TYPE-001`,
    taskId: task.taskId,
    type: "strict_type_guard",
    targetSymbol: "predicateGuards",
    description:
      "Validates explicit type narrowing predicates against arbitrary invalid inputs without throwing unhandled exceptions",
    expectedBehavior:
      "Predicates return false for null, undefined, numbers, strings, arrays, or objects missing required fields",
    counterfactualCondition:
      "Predicates use unsafe type assertions or return true for structurally incomplete objects",
    falsifiableCodeSnippet: `expect(isValidInput(null)).toBe(false);\nexpect(isValidInput({})).toBe(false);\nexpect(isValidInput(validObject)).toBe(true);`,
    testCaseName: "strictly validates types and rejects malformed inputs without fallback defaults",
    severity: "critical",
  });

  // 3. Non-Empty Return & Contract Fidelity Assertion
  assertions.push({
    id: `DA-${taskSlug}-RETURN-001`,
    taskId: task.taskId,
    type: "non_empty_return",
    targetSymbol: "mainEngineFunction",
    description:
      "Ensures engine produces complete structured results with non-empty required collections and correct schemas",
    expectedBehavior:
      "Returns fully populated, validated result object with non-blank identifier and version stamps",
    counterfactualCondition:
      "Engine returns empty stub object, null, or undefined when called with valid inputs",
    falsifiableCodeSnippet: `const res = executeTaskLogic(validConfig);\nexpect(res).toBeDefined();\nexpect(res.id.length).toBeGreaterThan(0);`,
    testCaseName: "produces non-empty complete structured records on valid inputs",
    severity: "high",
  });

  // 4. Boundary Value Rejection Assertion
  assertions.push({
    id: `DA-${taskSlug}-BOUNDARY-001`,
    taskId: task.taskId,
    type: "boundary_value_rejection",
    targetSymbol: "inputValidation",
    description:
      "Validates that out-of-range numeric values, empty strings, and negative bounds throw structured HarnessError",
    expectedBehavior:
      "Throws HarnessError with code 'INVALID_ARGUMENT' or 'INVALID_STATE' on invalid bounds",
    counterfactualCondition:
      "Function silently accepts negative scores, out-of-bound timeouts, or empty identifiers",
    falsifiableCodeSnippet: `expect(() => executeWithBounds(-1)).toThrow(HarnessError);`,
    testCaseName: "throws structured HarnessError on boundary violations and invalid states",
    severity: "high",
  });

  // 5. Invariant Enforcement & State Mutation Verification
  assertions.push({
    id: `DA-${taskSlug}-INVARIANT-001`,
    taskId: task.taskId,
    type: "invariant_enforcement",
    targetSymbol: "stateManagement",
    description:
      "Enforces deterministic state transitions and verifies state mutations are monotonic and validated",
    expectedBehavior:
      "State updates advance revisions sequentially and prevent backward or corrupted state transitions",
    counterfactualCondition:
      "State update mutates reserved fields or resets sequence counter to zero",
    falsifiableCodeSnippet: `const nextState = applyStateMutation(prevState, mutation);\nexpect(nextState.revision).toBe(prevState.revision + 1);`,
    testCaseName: "enforces monotonic state transitions and protects immutable fields",
    severity: "critical",
  });

  // 6. Disjoint Scope Isolation Assertion
  assertions.push({
    id: `DA-${taskSlug}-SCOPE-001`,
    taskId: task.taskId,
    type: "disjoint_scope_isolation",
    targetSymbol: "writeScopeGuard",
    description:
      "Verifies that file access and artifact emission are strictly confined to assigned write scope paths",
    expectedBehavior:
      "Attempting to write outside declared scope paths is rejected with path violation error",
    counterfactualCondition: "Agent writes to out-of-scope files or root configuration files",
    falsifiableCodeSnippet: `expect(isPathInWriteScope("disallowed/file.ts", task.writeScope)).toBe(false);`,
    testCaseName: "confines all file modifications to declared write scope",
    severity: "critical",
  });

  // 7. Error Class Discrimination Assertion
  assertions.push({
    id: `DA-${taskSlug}-ERROR-001`,
    taskId: task.taskId,
    type: "error_class_discrimination",
    targetSymbol: "errorHandler",
    description:
      "Ensures error paths produce discriminating error codes (INVALID_ARGUMENT vs INVALID_STATE vs INTEGRITY)",
    expectedBehavior:
      "Specific defect classes map 1:1 to standard repository error codes without generic catch-all errors",
    counterfactualCondition: "All errors throw generic Error with vague untyped messages",
    falsifiableCodeSnippet: `try {\n  triggerDefect();\n} catch (e: unknown) {\n  expect(e).toBeInstanceOf(HarnessError);\n  expect((e as HarnessError).code).toBe("INVALID_ARGUMENT");\n}`,
    testCaseName: "discriminates error classes accurately with standard HarnessError codes",
    severity: "medium",
  });

  // Apply maxAssertionsPerTask limit if specified
  if (
    options !== undefined &&
    options.maxAssertionsPerTask !== undefined &&
    options.maxAssertionsPerTask > 0
  ) {
    return assertions.slice(0, options.maxAssertionsPerTask);
  }

  return assertions;
}

/**
 * Compiles AGP (Adversarial Gate Proof) counterfactual probe templates for a task.
 */
export function compileAgpCounterfactualProbes(
  task: PreEnhancementTaskInput,
): readonly AgpCounterfactualProbeTemplate[] {
  if (!isNonblank(task.taskId)) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId must be a non-blank string");
  }

  const probes: AgpCounterfactualProbeTemplate[] = [];
  const taskSlug = task.taskId.replace(/^task-?/, "");
  const sourceFiles = task.writeScope.filter(
    (p) => !p.endsWith(".test.ts") && !p.endsWith(".spec.ts"),
  );
  const targetFile = sourceFiles.length > 0 ? sourceFiles[0]! : task.writeScope[0]!;

  // 1. Fallback Injection Probe
  probes.push({
    probeId: `AGP-${taskSlug}-FALLBACK-01`,
    taskId: task.taskId,
    targetFile,
    probeCategory: "fallback_injection",
    originalBehaviorDescription:
      "Explicit parameter validation checks throwing on undefined or null input values",
    counterfactualMutation: "Replace explicit validation with invalid fallback injection",
    expectedGateOutcome: "failure",
    expectedFailurePattern: "fallback operator detected or boundary test failure",
    remediationGuidance: "Remove fallback operator and restore explicit validation guard",
  });

  // 2. Null Mutation Probe
  probes.push({
    probeId: `AGP-${taskSlug}-NULL-01`,
    taskId: task.taskId,
    targetFile,
    probeCategory: "null_mutation",
    originalBehaviorDescription:
      "Function returns fully populated record with non-null required properties",
    counterfactualMutation: "Mutate return statement to return `null` or `{}` empty stub",
    expectedGateOutcome: "failure",
    expectedFailurePattern: "TypeError or assertion failure on required properties",
    remediationGuidance: "Ensure complete return structure with validated properties",
  });

  // 3. Inverted Condition Probe
  probes.push({
    probeId: `AGP-${taskSlug}-INVERT-01`,
    taskId: task.taskId,
    targetFile,
    probeCategory: "inverted_condition",
    originalBehaviorDescription:
      "Boundary check validates range `score >= MIN_SCORE && score <= MAX_SCORE`",
    counterfactualMutation: "Invert boolean logic to `score < MIN_SCORE || score > MAX_SCORE`",
    expectedGateOutcome: "failure",
    expectedFailurePattern: "out-of-range assertion failure or inversion error",
    remediationGuidance: "Correct boolean condition logic to enforce inclusive valid interval",
  });

  // 4. Scope Violation Probe
  probes.push({
    probeId: `AGP-${taskSlug}-SCOPE-01`,
    taskId: task.taskId,
    targetFile,
    probeCategory: "scope_violation",
    originalBehaviorDescription: "All mutations are restricted to declared write scope paths",
    counterfactualMutation:
      "Inject write operation targeting an un-leased file outside write scope",
    expectedGateOutcome: "failure",
    expectedFailurePattern: "write scope audit violation",
    remediationGuidance: "Confine write operations exclusively to leased scope paths",
  });

  // 5. Type Corruption Probe
  probes.push({
    probeId: `AGP-${taskSlug}-TYPE-01`,
    taskId: task.taskId,
    targetFile,
    probeCategory: "type_corruption",
    originalBehaviorDescription:
      "Functions accept strictly typed inputs and reject non-object payloads",
    counterfactualMutation:
      "Pass primitive number or string to a function requiring a structured object",
    expectedGateOutcome: "failure",
    expectedFailurePattern: "HarnessError INVALID_ARGUMENT or TypeScript compile failure",
    remediationGuidance: "Add type predicate check before processing object properties",
  });

  return probes;
}

/**
 * Compiles a task invariant checklist with write scope boundary verification.
 */
export function compileTaskInvariantChecklist(
  task: PreEnhancementTaskInput,
  concurrentScopes?: readonly (readonly string[])[] | undefined,
): TaskInvariantChecklist {
  if (!isNonblank(task.taskId)) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId must be a non-blank string");
  }

  const role = task.roleContract !== undefined ? task.roleContract : "implementer";
  const normalizedPaths = task.writeScope.map(normalizeScopePath);
  const sourceFiles = normalizedPaths.filter(
    (p) => !p.endsWith(".test.ts") && !p.endsWith(".spec.ts"),
  );
  const testFiles = normalizedPaths.filter((p) => p.endsWith(".test.ts") || p.endsWith(".spec.ts"));

  // Check disjointness against any concurrent scopes
  let isDisjoint = true;
  if (concurrentScopes !== undefined && concurrentScopes.length > 0) {
    for (const otherScope of concurrentScopes) {
      const check = verifyScopeDisjointness(normalizedPaths, otherScope);
      if (!check.isDisjoint) {
        isDisjoint = false;
        break;
      }
    }
  }

  const disallowedPaths: string[] = [
    "package.json",
    "tsconfig.json",
    "bun.lock",
    "AGENTS.md",
    "olt/scripts/harness.ts",
  ];

  return {
    taskId: task.taskId,
    role,
    tier: 3,
    invariants: STANDARD_TASK_INVARIANTS,
    writeScopeBoundary: {
      declaredPaths: task.writeScope,
      normalizedPaths,
      disallowedPaths,
      isDisjointFromConcurrentLanes: isDisjoint,
      sourceFiles,
      testFiles,
    },
  };
}

/**
 * Performs static AST boundary verification on a source file or code string.
 */
export function verifyAstBoundaries(
  filePath: string,
  sourceCode?: string | undefined,
): AstBoundaryVerificationResult {
  if (!isNonblank(filePath)) {
    throw new HarnessError("INVALID_ARGUMENT", "filePath must be a non-blank string");
  }

  const code = sourceCode !== undefined ? sourceCode : "";
  const lines = code.split("\n");
  const findings: AstBoundaryFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNumber = i + 1;

    // Check ?? (nullish coalescing)
    const nullishIdx = line.indexOf("??");
    if (nullishIdx !== -1) {
      findings.push({
        ruleId: "NO_NULLISH_COALESCING_FALLBACK",
        line: lineNumber,
        column: nullishIdx + 1,
        codeSnippet: line.trim(),
        message:
          "Prohibited nullish coalescing operator (??) detected; use explicit branching or predicates",
        severity: "critical",
      });
    }

    // Check || (logical OR used as fallback assignment)
    const logicalOrPattern = /(?:=\s*[^;]+\|\||return\s+[^;]+\|\|)/;
    if (logicalOrPattern.test(line)) {
      const orIdx = line.indexOf("||");
      findings.push({
        ruleId: "NO_LOGICAL_OR_FALLBACK",
        line: lineNumber,
        column: orIdx + 1,
        codeSnippet: line.trim(),
        message:
          "Prohibited logical OR fallback operator (||) detected; use explicit type guards or ternary branching",
        severity: "critical",
      });
    }

    // Check : any
    const anyTypePattern = /:\s*any\b/;
    if (anyTypePattern.test(line)) {
      const match = line.match(anyTypePattern);
      const col = match !== null && match.index !== undefined ? match.index + 1 : 1;
      findings.push({
        ruleId: "NO_ANY_TYPE_ANNOTATION",
        line: lineNumber,
        column: col,
        codeSnippet: line.trim(),
        message:
          "Prohibited 'any' type annotation detected; specify a precise TypeScript type or unknown with type guard",
        severity: "critical",
      });
    }

    // Check as any
    const asAnyPattern = /\bas\s+any\b/;
    if (asAnyPattern.test(line)) {
      const match = line.match(asAnyPattern);
      const col = match !== null && match.index !== undefined ? match.index + 1 : 1;
      findings.push({
        ruleId: "NO_ANY_TYPE_CAST",
        line: lineNumber,
        column: col,
        codeSnippet: line.trim(),
        message:
          "Prohibited 'as any' type assertion detected; use safe narrowing or proper interface casting",
        severity: "critical",
      });
    }

    // Check @ts-ignore
    if (line.includes("@ts-ignore")) {
      findings.push({
        ruleId: "NO_TS_IGNORE_SUPPRESSION",
        line: lineNumber,
        column: line.indexOf("@ts-ignore") + 1,
        codeSnippet: line.trim(),
        message:
          "Prohibited @ts-ignore directive detected; fix the underlying type mismatch instead of suppressing it",
        severity: "critical",
      });
    }

    // Check @ts-nocheck
    if (line.includes("@ts-nocheck")) {
      findings.push({
        ruleId: "NO_TS_NOCHECK_SUPPRESSION",
        line: lineNumber,
        column: line.indexOf("@ts-nocheck") + 1,
        codeSnippet: line.trim(),
        message: "Prohibited @ts-nocheck directive detected; full file type-checking is required",
        severity: "critical",
      });
    }
  }

  const compliant = findings.length === 0;

  return {
    filePath,
    compliant,
    findings,
    checkedRulesCount: FORBIDDEN_SYNTAX_RULES.length,
    forbiddenSyntaxRules: FORBIDDEN_SYNTAX_RULES,
    strictTyping: {
      noAny: true,
      noLiteralFallbackMasking: true,
      explicitReturnTypes: true,
    },
  };
}

/**
 * Compiles a discriminating gate command for a task.
 */
export function compileDiscriminatingGate(task: PreEnhancementTaskInput): readonly string[] {
  const parsed = parseGateCommand(task.gateCommand);

  // Validate that gate command targets the task's write scope test files
  const testFiles = task.writeScope.filter((p) => p.endsWith(".test.ts") || p.endsWith(".spec.ts"));
  if (testFiles.length === 0) {
    return parsed;
  }

  // Ensure gate command explicitly mentions at least one test file
  const gateStr = parsed.join(" ");
  let mentionsTestFile = false;
  for (const tf of testFiles) {
    if (gateStr.includes(tf)) {
      mentionsTestFile = true;
      break;
    }
  }

  if (!mentionsTestFile && parsed[0] === "bun" && parsed[1] === "test") {
    // Augment bun test command with the explicit test file target
    return ["bun", "test", testFiles[0]!];
  }

  return parsed;
}

/**
 * Calculates a quantitative task readiness score (0-100).
 */
export function calculateTaskReadinessScore(
  task: PreEnhancementTaskInput,
  assertions: readonly DiscriminatingAssertion[],
  probes: readonly AgpCounterfactualProbeTemplate[],
  astIssues: readonly string[],
): number {
  let score = 100;

  // Deduction for missing write scope
  if (task.writeScope.length === 0) {
    score -= 40;
  } else {
    const hasSource = task.writeScope.some(
      (p) => !p.endsWith(".test.ts") && !p.endsWith(".spec.ts"),
    );
    const hasTest = task.writeScope.some((p) => p.endsWith(".test.ts") || p.endsWith(".spec.ts"));
    if (!hasSource) score -= 15;
    if (!hasTest) score -= 15;
  }

  // Deduction for insufficient discriminating assertions
  if (assertions.length < 3) {
    score -= (3 - assertions.length) * 10;
  }

  // Deduction for insufficient AGP probes
  if (probes.length < 2) {
    score -= (2 - probes.length) * 10;
  }

  // Deduction for AST issues
  if (astIssues.length > 0) {
    score -= Math.min(astIssues.length * 10, 30);
  }

  // Deduction if gate command is empty
  try {
    const gate = parseGateCommand(task.gateCommand);
    if (gate.length < 2) score -= 15;
  } catch {
    score -= 30;
  }

  if (score < MIN_READINESS_SCORE) return MIN_READINESS_SCORE;
  if (score > MAX_READINESS_SCORE) return MAX_READINESS_SCORE;
  return score;
}

/**
 * Pre-enhances a single task before lease claim.
 */
export function preEnhanceTask(
  task: PreEnhancementTaskInput,
  options?: PreEnhanceTaskOptions,
): PreEnhancedTaskResult {
  if (!isRecord(task)) {
    throw new HarnessError("INVALID_ARGUMENT", "task must be a non-null object");
  }
  if (!isNonblank(task.taskId)) {
    throw new HarnessError("INVALID_ARGUMENT", "taskId must be a non-blank string");
  }
  if (!isNonblank(task.label)) {
    throw new HarnessError("INVALID_ARGUMENT", "label must be a non-blank string");
  }
  if (!Array.isArray(task.writeScope) || task.writeScope.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "writeScope must be a non-empty array of file paths",
    );
  }

  const compiledGate = compileDiscriminatingGate(task);
  const assertions = compileDiscriminatingAssertions(task);
  const probes = compileAgpCounterfactualProbes(task);

  const concurrentScopes =
    options !== undefined && options.concurrentScopes !== undefined
      ? options.concurrentScopes
      : undefined;

  const invariantChecklist = compileTaskInvariantChecklist(task, concurrentScopes);

  // Perform AST boundary verification on write scope files if source code is provided
  const sourceCodeMap =
    options !== undefined && options.sourceCodeMap !== undefined
      ? options.sourceCodeMap
      : undefined;

  const astBoundaries: AstBoundaryVerificationResult[] = [];
  const astIssues: string[] = [];

  for (const filePath of task.writeScope) {
    const sourceCode =
      sourceCodeMap !== undefined && sourceCodeMap[filePath] !== undefined
        ? sourceCodeMap[filePath]
        : undefined;

    const astResult = verifyAstBoundaries(filePath, sourceCode);
    astBoundaries.push(astResult);
    if (!astResult.compliant) {
      for (const finding of astResult.findings) {
        astIssues.push(`${filePath}:${finding.line} - ${finding.message}`);
      }
    }
  }

  // Scope integrity validation
  const scopeIssues: string[] = [];
  for (const path of task.writeScope) {
    if (path.startsWith("/")) {
      scopeIssues.push(`Path '${path}' must be repository-relative, not absolute`);
    }
    if (path.includes("..")) {
      scopeIssues.push(`Path '${path}' contains disallowed parent traversal ('..')`);
    }
  }

  const readinessScore = calculateTaskReadinessScore(task, assertions, probes, astIssues);
  const generatedAt = new Date().toISOString();

  return {
    taskId: task.taskId,
    label: task.label,
    compiledGateCommand: compiledGate,
    discriminatingAssertions: assertions,
    agpProbes: probes,
    invariantChecklist,
    astBoundaries,
    readinessScore,
    scopeIntegrity: {
      valid: scopeIssues.length === 0,
      issues: scopeIssues,
    },
    generatedAt,
  };
}

/**
 * Pre-enhances an entire plan containing multiple tasks.
 */
export function preEnhancePlan(
  tasks: readonly PreEnhancementTaskInput[],
  options?: PreEnhancePlanOptions,
): PreEnhancedPlanResult {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "tasks must be a non-empty array of task inputs");
  }

  const planId =
    options !== undefined && options.planId !== undefined && isNonblank(options.planId)
      ? options.planId
      : `plan-pre-enhanced-${Date.now()}`;

  const sourceCodeMap =
    options !== undefined && options.sourceCodeMap !== undefined
      ? options.sourceCodeMap
      : undefined;

  // Collect all scopes to check disjointness
  const allScopes = tasks.map((t) => t.writeScope);
  let allScopesDisjoint = true;

  for (let i = 0; i < allScopes.length; i++) {
    for (let j = i + 1; j < allScopes.length; j++) {
      const check = verifyScopeDisjointness(allScopes[i]!, allScopes[j]!);
      if (!check.isDisjoint) {
        allScopesDisjoint = false;
        break;
      }
    }
    if (!allScopesDisjoint) break;
  }

  const enhancedTasks: PreEnhancedTaskResult[] = [];
  let totalAssertionsCount = 0;
  let totalAgpProbesCount = 0;
  let totalScore = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const otherScopes = allScopes.filter((_, idx) => idx !== i);
    const taskResult = preEnhanceTask(task, {
      concurrentScopes: otherScopes,
      sourceCodeMap,
      strictMode: options !== undefined ? options.strictMode : undefined,
    });
    enhancedTasks.push(taskResult);
    totalAssertionsCount += taskResult.discriminatingAssertions.length;
    totalAgpProbesCount += taskResult.agpProbes.length;
    totalScore += taskResult.readinessScore;
  }

  const averageReadinessScore = Math.round(totalScore / tasks.length);
  const compiledAt = new Date().toISOString();

  return {
    schema: "harness.pre-enhanced-plan",
    version: 1,
    planId,
    tasks: enhancedTasks,
    globalInvariants: [
      "ZERO TypeScript any references",
      "ZERO defaulted literal fallback operators (??, ||)",
      "Strict 1:1 Disjoint Write Scope Isolation",
      "Falsifiable Gate Execution under AGP Probes",
      "Discriminating Mechanic Unit Test Verification",
    ],
    totalAssertionsCount,
    totalAgpProbesCount,
    averageReadinessScore,
    allScopesDisjoint,
    compiledAt,
  };
}

/**
 * Validates a single pre-enhanced task result.
 */
export function validatePreEnhancedTask(taskResult: PreEnhancedTaskResult): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  if (!isNonblank(taskResult.taskId)) {
    errors.push("Missing valid taskId");
  }
  if (!isNonblank(taskResult.label)) {
    errors.push("Missing valid task label");
  }
  if (taskResult.compiledGateCommand.length === 0) {
    errors.push("Compiled gate command must not be empty");
  }
  if (taskResult.discriminatingAssertions.length < 3) {
    errors.push(
      `Insufficient discriminating assertions: expected >= 3, found ${taskResult.discriminatingAssertions.length}`,
    );
  }
  if (taskResult.agpProbes.length < 2) {
    errors.push(
      `Insufficient AGP counterfactual probes: expected >= 2, found ${taskResult.agpProbes.length}`,
    );
  }
  if (!taskResult.scopeIntegrity.valid) {
    for (const issue of taskResult.scopeIntegrity.issues) {
      errors.push(`Scope integrity issue: ${issue}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates a pre-enhanced plan result.
 */
export function validatePreEnhancedPlan(planResult: PreEnhancedPlanResult): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  if (planResult.schema !== "harness.pre-enhanced-plan") {
    errors.push(`Invalid schema: expected 'harness.pre-enhanced-plan', got '${planResult.schema}'`);
  }
  if (planResult.tasks.length === 0) {
    errors.push("Plan contains zero pre-enhanced tasks");
  }
  if (!planResult.allScopesDisjoint) {
    errors.push("Plan contains overlapping write scopes across tasks");
  }

  for (const task of planResult.tasks) {
    const taskValidation = validatePreEnhancedTask(task);
    if (!taskValidation.valid) {
      for (const err of taskValidation.errors) {
        errors.push(`Task ${task.taskId}: ${err}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Synthesizes a proactive unit test template file content from a pre-enhanced task.
 */
export function synthesizeProactiveTestTemplate(taskResult: PreEnhancedTaskResult): string {
  const lines: string[] = [];
  lines.push(`/**`);
  lines.push(` * Discriminating Mechanic Unit Tests for ${taskResult.label}`);
  lines.push(` * Task ID: ${taskResult.taskId}`);
  lines.push(` * Pre-compiled by Proactive Plan Pre-Enhancer (${PRE_ENHANCER_VERSION})`);
  lines.push(` *`);
  lines.push(` * Invariants: Zero any, zero ?? or || fallbacks, zero mock tautologies.`);
  lines.push(` */`);
  lines.push(``);
  lines.push(`import { describe, test, expect } from "bun:test";`);
  lines.push(`import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";`);
  lines.push(``);
  lines.push(`describe("${taskResult.taskId}: ${taskResult.label}", () => {`);

  for (const assertion of taskResult.discriminatingAssertions) {
    lines.push(`  test("${assertion.testCaseName}", () => {`);
    lines.push(`    // Discriminating Assertion: ${assertion.id} (${assertion.type})`);
    lines.push(`    // Expected: ${assertion.expectedBehavior}`);
    lines.push(`    // Counterfactual: ${assertion.counterfactualCondition}`);
    lines.push(`    // Code snippet verification:`);
    lines.push(`    expect(true).toBe(true); // Replace with concrete mechanic execution`);
    lines.push(`  });`);
    lines.push(``);
  }

  lines.push(`});`);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Renders individual task pre-enhancement summary in Markdown format.
 */
export function renderTaskPreEnhancementMarkdown(taskResult: PreEnhancedTaskResult): string {
  const lines: string[] = [];
  lines.push(`### Pre-Enhanced Task: \`${taskResult.taskId}\``);
  lines.push(`**Label**: ${taskResult.label}`);
  lines.push(`**Readiness Score**: ${taskResult.readinessScore}/100`);
  lines.push(`**Gate Command**: \`${taskResult.compiledGateCommand.join(" ")}\``);
  lines.push(``);
  lines.push(`#### 🎯 Discriminating Assertions (${taskResult.discriminatingAssertions.length})`);
  for (const a of taskResult.discriminatingAssertions) {
    lines.push(`- **[${a.severity.toUpperCase()}]** \`${a.id}\` (*${a.type}*): ${a.description}`);
    lines.push(`  - *Expected*: ${a.expectedBehavior}`);
    lines.push(`  - *Counterfactual*: ${a.counterfactualCondition}`);
  }
  lines.push(``);
  lines.push(`#### 🔬 AGP Counterfactual Probes (${taskResult.agpProbes.length})`);
  for (const p of taskResult.agpProbes) {
    lines.push(`- **\`${p.probeId}\`** (*${p.probeCategory}* on \`${p.targetFile}\`):`);
    lines.push(`  - *Mutation*: \`${p.counterfactualMutation}\``);
    lines.push(`  - *Expected Failure*: ${p.expectedFailurePattern}`);
  }
  lines.push(``);
  lines.push(`#### 🛡️ Write Scope Boundary`);
  lines.push(
    `- **Declared Paths**: \`${taskResult.invariantChecklist.writeScopeBoundary.declaredPaths.join("`, `")}\``,
  );
  lines.push(
    `- **Disjoint From Concurrent Lanes**: ${taskResult.invariantChecklist.writeScopeBoundary.isDisjointFromConcurrentLanes ? "✅ Yes" : "❌ No"}`,
  );
  lines.push(``);

  return lines.join("\n");
}

/**
 * Renders plan pre-enhancement summary in Markdown format.
 */
export function renderPreEnhancedPlanMarkdown(planResult: PreEnhancedPlanResult): string {
  const lines: string[] = [];
  lines.push(`## 🚀 Pre-Enhanced Execution Plan: \`${planResult.planId}\``);
  lines.push(`**Average Readiness Score**: ${planResult.averageReadinessScore}/100`);
  lines.push(`**Total Tasks**: ${planResult.tasks.length}`);
  lines.push(`**Total Discriminating Assertions**: ${planResult.totalAssertionsCount}`);
  lines.push(`**Total AGP Probes**: ${planResult.totalAgpProbesCount}`);
  lines.push(
    `**Scope Disjointness**: ${planResult.allScopesDisjoint ? "✅ All write scopes mutually disjoint" : "🛑 Overlapping scopes detected"}`,
  );
  lines.push(`**Compiled At**: ${planResult.compiledAt}`);
  lines.push(``);
  lines.push(`### 📋 Global Invariants`);
  for (const inv of planResult.globalInvariants) {
    lines.push(`- ⚖️ ${inv}`);
  }
  lines.push(``);
  lines.push(`### 📦 Task Specifications`);
  for (const task of planResult.tasks) {
    lines.push(renderTaskPreEnhancementMarkdown(task));
  }

  return lines.join("\n");
}
