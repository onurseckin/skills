import ts from "typescript";
import type {
  MutantExecutionResult,
  MutantRecord,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
  MutationType,
  MutationViolation,
} from "./anti-mock-types.ts";

interface MutationCandidate {
  readonly mutationType: MutationType;
  readonly description: string;
  readonly startPosition: number;
  readonly endPosition: number;
  readonly originalText: string;
  readonly replacementText: string;
  readonly line: number;
  readonly column: number;
}

function shouldSkipStringLiteral(node: ts.StringLiteral): boolean {
  const parent = node.parent;
  if (!parent) return false;
  // Skip import / export declarations
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  // Skip require calls
  if (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === "require"
  ) {
    return true;
  }
  // Skip directive prologues e.g. "use strict"
  if (ts.isExpressionStatement(parent) && parent.parent && ts.isSourceFile(parent.parent)) {
    return true;
  }
  // Skip object property names if not computed
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;

  return false;
}

export function generateMutants(sourceCode: string, options?: MutationGateOptions): MutantRecord[] {
  const allowedTypes = options?.mutationTypes
    ? new Set<MutationType>(options.mutationTypes)
    : undefined;
  const fileName =
    typeof options?.file === "string" && options.file.length > 0 ? options.file : "source.ts";

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const candidates: MutationCandidate[] = [];

  function addCandidate(
    mutationType: MutationType,
    description: string,
    start: number,
    end: number,
    originalText: string,
    replacementText: string,
  ): void {
    if (allowedTypes && !allowedTypes.has(mutationType)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    candidates.push({
      mutationType,
      description,
      startPosition: start,
      endPosition: end,
      originalText,
      replacementText,
      line: line + 1,
      column: character + 1,
    });
  }

  function walk(node: ts.Node): void {
    // 1. Boolean Keywords
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      addCandidate(
        "invert_boolean",
        "Invert true to false",
        node.getStart(sourceFile),
        node.getEnd(),
        "true",
        "false",
      );
    } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
      addCandidate(
        "invert_boolean",
        "Invert false to true",
        node.getStart(sourceFile),
        node.getEnd(),
        "false",
        "true",
      );
    }

    // 2. Unary ! Inversion
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      const operandText = node.operand.getText(sourceFile);
      addCandidate(
        "invert_boolean",
        `Remove logical NOT (!${operandText} -> ${operandText})`,
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        operandText,
      );
    }

    // 3. Binary Expressions: Equality, Comparison, Arithmetic, Logical
    if (ts.isBinaryExpression(node)) {
      const opToken = node.operatorToken;
      const opKind = opToken.kind;

      // Comparison / Equality
      if (opKind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate === to !==",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "===",
          "!==",
        );
      } else if (opKind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate !== to ===",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "!==",
          "===",
        );
      } else if (opKind === ts.SyntaxKind.EqualsEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate == to !=",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "==",
          "!=",
        );
      } else if (opKind === ts.SyntaxKind.ExclamationEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate != to ==",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "!=",
          "==",
        );
      } else if (opKind === ts.SyntaxKind.LessThanToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate < to >=",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "<",
          ">=",
        );
      } else if (opKind === ts.SyntaxKind.LessThanEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate <= to >",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "<=",
          ">",
        );
      } else if (opKind === ts.SyntaxKind.GreaterThanToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate > to <=",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          ">",
          "<=",
        );
      } else if (opKind === ts.SyntaxKind.GreaterThanEqualsToken) {
        addCandidate(
          "comparison_mutation",
          "Mutate >= to <",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          ">=",
          "<",
        );
      }

      // Logical Operators
      if (opKind === ts.SyntaxKind.AmpersandAmpersandToken) {
        addCandidate(
          "logical_operator_mutation",
          "Mutate && to " + "||",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "&&",
          "||",
        );
      } else if (opKind === ts.SyntaxKind.BarBarToken) {
        addCandidate(
          "logical_operator_mutation",
          "Mutate || to " + "&&",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "||",
          "&&",
        );
      }

      // Arithmetic Operators
      if (opKind === ts.SyntaxKind.PlusToken) {
        addCandidate(
          "arithmetic_mutation",
          "Mutate + to -",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "+",
          "-",
        );
      } else if (opKind === ts.SyntaxKind.MinusToken) {
        addCandidate(
          "arithmetic_mutation",
          "Mutate - to +",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "-",
          "+",
        );
      } else if (opKind === ts.SyntaxKind.AsteriskToken) {
        addCandidate(
          "arithmetic_mutation",
          "Mutate * to /",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "*",
          "/",
        );
      } else if (opKind === ts.SyntaxKind.SlashToken) {
        addCandidate(
          "arithmetic_mutation",
          "Mutate / to *",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "/",
          "*",
        );
      } else if (opKind === ts.SyntaxKind.PercentToken) {
        addCandidate(
          "arithmetic_mutation",
          "Mutate % to *",
          opToken.getStart(sourceFile),
          opToken.getEnd(),
          "%",
          "*",
        );
      }
    }

    // 4. Return Value Flipping
    if (ts.isReturnStatement(node)) {
      if (node.expression) {
        const expr = node.expression;
        if (expr.kind === ts.SyntaxKind.TrueKeyword) {
          addCandidate(
            "flip_return_value",
            "Flip return true to return false",
            node.getStart(sourceFile),
            node.getEnd(),
            node.getText(sourceFile),
            "return false;",
          );
        } else if (expr.kind === ts.SyntaxKind.FalseKeyword) {
          addCandidate(
            "flip_return_value",
            "Flip return false to return true",
            node.getStart(sourceFile),
            node.getEnd(),
            node.getText(sourceFile),
            "return true;",
          );
        } else if (ts.isNumericLiteral(expr)) {
          const numVal = Number(expr.text);
          const replacement = numVal === 0 ? "1" : "0";
          addCandidate(
            "flip_return_value",
            `Flip return ${expr.text} to return ${replacement}`,
            node.getStart(sourceFile),
            node.getEnd(),
            node.getText(sourceFile),
            `return ${replacement};`,
          );
        } else if (ts.isStringLiteral(expr)) {
          const replacement = expr.text.length > 0 ? '""' : '"__MUTATED__"';
          addCandidate(
            "flip_return_value",
            `Flip return string to ${replacement}`,
            node.getStart(sourceFile),
            node.getEnd(),
            node.getText(sourceFile),
            `return ${replacement};`,
          );
        } else {
          addCandidate(
            "flip_return_value",
            "Flip return value to return undefined",
            node.getStart(sourceFile),
            node.getEnd(),
            node.getText(sourceFile),
            "return undefined;",
          );
        }
      } else {
        addCandidate(
          "flip_return_value",
          "Flip bare return to return true",
          node.getStart(sourceFile),
          node.getEnd(),
          node.getText(sourceFile),
          "return true;",
        );
      }
    }

    // 5. Function Body Stripping
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      node.body.statements.length > 0
    ) {
      addCandidate(
        "strip_function_body",
        "Strip function body statements",
        node.body.getStart(sourceFile),
        node.body.getEnd(),
        node.body.getText(sourceFile),
        "{ return undefined; }",
      );
    }

    // 6. String Literal Mutation
    if (ts.isStringLiteral(node) && !shouldSkipStringLiteral(node)) {
      const replacement = node.text.length > 0 ? '""' : '"__MUTATED__"';
      addCandidate(
        "string_literal_mutation",
        `Mutate string literal to ${replacement}`,
        node.getStart(sourceFile),
        node.getEnd(),
        node.getText(sourceFile),
        replacement,
      );
    }

    ts.forEachChild(node, walk);
  }

  walk(sourceFile);

  const maxMutants =
    typeof options?.maxMutants === "number" ? options.maxMutants : candidates.length;
  const selectedCandidates = candidates.slice(0, maxMutants);

  return selectedCandidates.map((candidate, idx) => {
    const mutatedSource =
      sourceCode.slice(0, candidate.startPosition) +
      candidate.replacementText +
      sourceCode.slice(candidate.endPosition);

    return {
      id: `mutant-${idx + 1}`,
      mutationType: candidate.mutationType,
      description: candidate.description,
      line: candidate.line,
      column: candidate.column,
      startPosition: candidate.startPosition,
      endPosition: candidate.endPosition,
      originalText: candidate.originalText,
      mutatedText: candidate.replacementText,
      mutatedSource,
    };
  });
}

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
