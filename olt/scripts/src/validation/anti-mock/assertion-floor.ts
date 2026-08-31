import ts from "typescript";
import type {
  AssertionFloorOptions,
  AssertionFloorResult,
  AssertionFloorViolation,
  TestAssertionSummary,
} from "./anti-mock-types.ts";

interface TestScopeInfo {
  readonly testName: string;
  readonly callback: ts.FunctionLikeDeclaration;
  readonly line: number;
  readonly column: number;
}

const TEST_IDENTIFIERS = new Set(["test", "it"]);

function isTestIdentifier(name: string): boolean {
  return TEST_IDENTIFIERS.has(name);
}

function extractTestName(args: ts.NodeArray<ts.Expression>): string {
  for (const arg of args) {
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
    if (ts.isTemplateExpression(arg)) {
      return arg.getText();
    }
  }
  return "<anonymous test>";
}

function findCallback(args: ts.NodeArray<ts.Expression>): ts.FunctionLikeDeclaration | undefined {
  for (const arg of args) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      return arg;
    }
  }
  return undefined;
}

function getRootTestIdentifier(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return getRootTestIdentifier(expr.expression);
  }
  if (ts.isCallExpression(expr)) {
    return getRootTestIdentifier(expr.expression);
  }
  return undefined;
}

function identifyTestCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): TestScopeInfo | undefined {
  const expr = node.expression;
  const rootId = getRootTestIdentifier(expr);

  const isTest =
    (rootId !== undefined && isTestIdentifier(rootId)) ||
    (ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.name) &&
      isTestIdentifier(expr.name.text));

  if (isTest) {
    const callback = findCallback(node.arguments);
    if (callback) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      return {
        testName: extractTestName(node.arguments),
        callback,
        line: line + 1,
        column: character + 1,
      };
    }
  }

  return undefined;
}

function isAssertionCall(call: ts.CallExpression, customIdentifiers: Set<string>): boolean {
  const expr = call.expression;

  if (ts.isIdentifier(expr)) {
    return expr.text === "expect" || expr.text === "assert" || customIdentifiers.has(expr.text);
  }

  let curr: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(curr) || ts.isCallExpression(curr)) {
    if (ts.isPropertyAccessExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        const id = curr.expression.text;
        if (id === "assert" || id === "expect" || id === "t" || customIdentifiers.has(id)) {
          return true;
        }
      }
      curr = curr.expression;
    } else if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        const id = curr.expression.text;
        if (id === "expect" || id === "assert" || customIdentifiers.has(id)) {
          return true;
        }
      }
      curr = curr.expression;
    } else {
      break;
    }
  }

  return false;
}

function countAssertionsInCallback(
  callback: ts.FunctionLikeDeclaration,
  customIdentifiers: Set<string>,
): number {
  let count = 0;
  const countedNodes = new Set<ts.Node>();

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (isAssertionCall(node, customIdentifiers)) {
        let isNested = false;
        let parent = node.parent;
        while (parent && parent !== callback.body) {
          if (ts.isCallExpression(parent) && isAssertionCall(parent, customIdentifiers)) {
            isNested = true;
            break;
          }
          parent = parent.parent;
        }
        if (!isNested && !countedNodes.has(node)) {
          countedNodes.add(node);
          count++;
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  if (callback.body) {
    if (ts.isCallExpression(callback.body) && isAssertionCall(callback.body, customIdentifiers)) {
      countedNodes.add(callback.body);
      count++;
    }
    walk(callback.body);
  }

  return count;
}

export function checkAssertionFloor(
  sourceCode: string,
  options?: AssertionFloorOptions,
): AssertionFloorResult {
  const minPerTest = options?.minAssertionsPerTest ?? 1;
  const minPerFile = options?.minAssertionsPerFile ?? 1;
  const fileName =
    typeof options?.file === "string" && options.file.length > 0 ? options.file : "test.ts";
  const customIdentifiers = new Set(options?.customAssertionIdentifiers ?? []);

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const testScopes: TestScopeInfo[] = [];

  function findTests(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node, sourceFile);
      if (testInfo) {
        testScopes.push(testInfo);
      }
    }
    ts.forEachChild(node, findTests);
  }

  findTests(sourceFile);

  const testsSummary: TestAssertionSummary[] = [];
  const violations: AssertionFloorViolation[] = [];
  let totalAssertions = 0;

  for (const testScope of testScopes) {
    const assertionCount = countAssertionsInCallback(testScope.callback, customIdentifiers);
    totalAssertions += assertionCount;

    const meetsFloor = assertionCount >= minPerTest;
    testsSummary.push({
      testName: testScope.testName,
      assertionCount,
      line: testScope.line,
      column: testScope.column,
      passed: meetsFloor,
    });

    if (assertionCount === 0) {
      violations.push({
        rule: "zero_assertions",
        message: `Test '${testScope.testName}' on line ${testScope.line} contains 0 assertions. Tests must contain at least ${minPerTest} assertion(s).`,
        file: fileName,
        line: testScope.line,
        column: testScope.column,
        testName: testScope.testName,
        actualCount: 0,
        expectedMin: minPerTest,
      });
    } else if (assertionCount < minPerTest) {
      violations.push({
        rule: "sub_floor_assertions",
        message: `Test '${testScope.testName}' on line ${testScope.line} contains ${assertionCount} assertion(s), below the required minimum floor of ${minPerTest}.`,
        file: fileName,
        line: testScope.line,
        column: testScope.column,
        testName: testScope.testName,
        actualCount: assertionCount,
        expectedMin: minPerTest,
      });
    }
  }

  if (totalAssertions < minPerFile) {
    violations.push({
      rule: "sub_floor_file_assertions",
      message: `Test file '${fileName}' contains a total of ${totalAssertions} assertion(s), below the file-level assertion floor of ${minPerFile}.`,
      file: fileName,
      line: 1,
      column: 1,
      actualCount: totalAssertions,
      expectedMin: minPerFile,
    });
  }

  const averageAssertionsPerTest =
    testScopes.length > 0 ? Number((totalAssertions / testScopes.length).toFixed(2)) : 0;

  return {
    passed: violations.length === 0,
    totalTests: testScopes.length,
    totalAssertions,
    minAssertionsPerTest: minPerTest,
    minAssertionsPerFile: minPerFile,
    tests: testsSummary,
    violations,
    averageAssertionsPerTest,
  };
}
