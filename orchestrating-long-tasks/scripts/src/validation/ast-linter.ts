import ts from "typescript";
import type {
  AstLinterOptions,
  AstLinterResult,
  AstLinterViolation,
} from "./anti-mock-types.ts";

interface TestCallInfo {
  readonly node: ts.CallExpression;
  readonly testName: string;
  readonly callback: ts.FunctionLikeDeclaration;
}

const TEST_IDENTIFIERS = new Set(["test", "it"]);
const MOCK_FACTORIES = new Set(["fn", "mock", "spyOn", "mockReturnValue", "mockResolvedValue", "mockImplementation"]);

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

function identifyTestCall(node: ts.CallExpression): TestCallInfo | undefined {
  const expr = node.expression;

  // Pattern: test("...", fn) or it("...", fn)
  if (ts.isIdentifier(expr) && isTestIdentifier(expr.text)) {
    const callback = findCallback(node.arguments);
    if (callback) {
      return { node, testName: extractTestName(node.arguments), callback };
    }
  }

  // Pattern: test.only("...", fn), test.skip("...", fn), it.concurrent("...", fn), describe.test("...", fn)
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    const prop = expr.name.text;
    if (
      (ts.isIdentifier(obj) && isTestIdentifier(obj.text)) ||
      (ts.isIdentifier(obj) && obj.text === "describe" && isTestIdentifier(prop)) ||
      (ts.isPropertyAccessExpression(obj) && ts.isIdentifier(obj.name) && isTestIdentifier(obj.name.text))
    ) {
      const callback = findCallback(node.arguments);
      if (callback) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }

  // Pattern: test.each([...])("...", fn)
  if (ts.isCallExpression(expr)) {
    const innerExpr = expr.expression;
    if (
      ts.isPropertyAccessExpression(innerExpr) &&
      ts.isIdentifier(innerExpr.expression) &&
      isTestIdentifier(innerExpr.expression.text) &&
      innerExpr.name.text === "each"
    ) {
      const callback = findCallback(node.arguments);
      if (callback) {
        return { node, testName: extractTestName(node.arguments), callback };
      }
    }
  }

  return undefined;
}

function isLiteralOrConstant(node: ts.Node): boolean {
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.NumericLiteral ||
    node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    node.kind === ts.SyntaxKind.ArrayLiteralExpression ||
    node.kind === ts.SyntaxKind.ObjectLiteralExpression
  ) {
    return true;
  }
  if (ts.isIdentifier(node) && (node.text === "undefined" || node.text === "NaN")) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    return true;
  }
  return false;
}

function isAssertionCall(call: ts.CallExpression): boolean {
  const expr = call.expression;
  if (ts.isIdentifier(expr)) {
    return expr.text === "expect" || expr.text === "assert";
  }
  let curr: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(curr) || ts.isCallExpression(curr)) {
    if (ts.isPropertyAccessExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        return (
          curr.expression.text === "assert" ||
          curr.expression.text === "expect" ||
          curr.expression.text === "t"
        );
      }
      curr = curr.expression;
    } else if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression)) {
        return curr.expression.text === "expect" || curr.expression.text === "assert";
      }
      curr = curr.expression;
    } else {
      break;
    }
  }
  return false;
}

function getRootExpectArg(node: ts.CallExpression): ts.Expression | undefined {
  if (ts.isIdentifier(node.expression) && node.expression.text === "expect") {
    return node.arguments[0];
  }
  let curr: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(curr) || ts.isCallExpression(curr)) {
    if (ts.isCallExpression(curr)) {
      if (ts.isIdentifier(curr.expression) && curr.expression.text === "expect") {
        return curr.arguments[0];
      }
      curr = curr.expression;
    } else if (ts.isPropertyAccessExpression(curr)) {
      curr = curr.expression;
    } else {
      break;
    }
  }
  return undefined;
}

function checkTrivialConstantAssertion(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  testName: string,
  fileName?: string,
): AstLinterViolation | undefined {
  const expr = call.expression;

  // Handle assert(true), assert.equal(1, 1), assert.isTrue(true), assert.strictEqual("a", "a")
  if (ts.isIdentifier(expr) && expr.text === "assert") {
    const firstArg = call.arguments[0];
    if (firstArg && firstArg.kind === ts.SyntaxKind.TrueKeyword) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
      return {
        rule: "trivial_constant_assertion",
        message: `Test '${testName}' contains trivial constant assertion 'assert(true)'.`,
        file: fileName,
        line: line + 1,
        column: character + 1,
        testName,
        snippet: call.getText(sourceFile),
      };
    }
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (ts.isIdentifier(expr.expression) && expr.expression.text === "assert") {
      const methodName = expr.name.text;
      const firstArg = call.arguments[0];
      const secondArg = call.arguments[1];

      if (
        (methodName === "isTrue" && firstArg && firstArg.kind === ts.SyntaxKind.TrueKeyword) ||
        (methodName === "isFalse" && firstArg && firstArg.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' contains trivial constant assertion 'assert.${methodName}(...)'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      if (
        (methodName === "equal" || methodName === "strictEqual" || methodName === "deepEqual") &&
        firstArg &&
        secondArg &&
        isLiteralOrConstant(firstArg) &&
        isLiteralOrConstant(secondArg) &&
        firstArg.getText(sourceFile) === secondArg.getText(sourceFile)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts constant literal against itself in 'assert.${methodName}(...)'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }
    }

    // Handle expect(actual).matcher(expected)
    const matcherName = expr.name.text;
    const rootArg = getRootExpectArg(call);

    if (rootArg) {
      const expectedArg = call.arguments[0];

      // Equality matchers comparing identical literals: expect(1).toBe(1), expect(true).toEqual(true)
      if (
        (matcherName === "toBe" ||
          matcherName === "toEqual" ||
          matcherName === "toStrictEqual" ||
          matcherName === "toBeStrictEqual") &&
        expectedArg &&
        isLiteralOrConstant(rootArg) &&
        isLiteralOrConstant(expectedArg) &&
        rootArg.getText(sourceFile) === expectedArg.getText(sourceFile)
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts constant literal against itself: '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      // Identity tautology: expect(x).toBe(x)
      if (
        (matcherName === "toBe" || matcherName === "toEqual" || matcherName === "toStrictEqual") &&
        expectedArg &&
        ts.isIdentifier(rootArg) &&
        ts.isIdentifier(expectedArg) &&
        rootArg.text === expectedArg.text
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' asserts variable '${rootArg.text}' against itself: '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }

      // Boolean/Null/Undefined/NaN/Defined matchers on literals
      if (
        (matcherName === "toBeTruthy" && rootArg.kind === ts.SyntaxKind.TrueKeyword) ||
        (matcherName === "toBeFalsy" && rootArg.kind === ts.SyntaxKind.FalseKeyword) ||
        (matcherName === "toBeNull" && rootArg.kind === ts.SyntaxKind.NullKeyword) ||
        (matcherName === "toBeUndefined" && ts.isIdentifier(rootArg) && rootArg.text === "undefined") ||
        (matcherName === "toBeNaN" && ts.isIdentifier(rootArg) && rootArg.text === "NaN") ||
        (matcherName === "toBeDefined" && isLiteralOrConstant(rootArg))
      ) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
        return {
          rule: "trivial_constant_assertion",
          message: `Test '${testName}' contains trivial constant assertion '${call.getText(sourceFile)}'.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: call.getText(sourceFile),
        };
      }
    }
  }

  return undefined;
}

interface MockInfo {
  readonly varName: string;
  readonly stubbedReturnValue?: string | undefined;
  readonly isMockObject?: boolean | undefined;
}

function detectMockDeclarations(callback: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): MockInfo[] {
  const mocks: MockInfo[] = [];

  function checkInitializer(init: ts.Expression): { isMock: boolean; stubbedValue?: string | undefined } {
    if (ts.isCallExpression(init)) {
      let curr: ts.Expression = init;
      let stubbedValue: string | undefined = undefined;

      while (ts.isCallExpression(curr) || ts.isPropertyAccessExpression(curr)) {
        if (ts.isCallExpression(curr)) {
          if (ts.isPropertyAccessExpression(curr.expression)) {
            const propName = curr.expression.name.text;
            if (propName === "mockReturnValue" || propName === "mockResolvedValue") {
              const valArg = curr.arguments[0];
              if (valArg) stubbedValue = valArg.getText(sourceFile);
            }
            if (MOCK_FACTORIES.has(propName)) {
              return { isMock: true, stubbedValue };
            }
            curr = curr.expression.expression;
          } else if (ts.isIdentifier(curr.expression)) {
            if (curr.expression.text === "mock" || curr.expression.text === "vi" || curr.expression.text === "jest") {
              const firstArg = curr.arguments[0];
              if (firstArg && (ts.isArrowFunction(firstArg) || ts.isFunctionExpression(firstArg))) {
                if (firstArg.body && !ts.isBlock(firstArg.body)) {
                  stubbedValue = firstArg.body.getText(sourceFile);
                }
              }
              return { isMock: true, stubbedValue };
            }
            break;
          } else {
            break;
          }
        } else if (ts.isPropertyAccessExpression(curr)) {
          if (
            ts.isIdentifier(curr.expression) &&
            (curr.expression.text === "vi" || curr.expression.text === "jest") &&
            MOCK_FACTORIES.has(curr.name.text)
          ) {
            return { isMock: true, stubbedValue };
          }
          curr = curr.expression;
        } else {
          break;
        }
      }
    }
    return { isMock: false };
  }

  function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const { isMock, stubbedValue } = checkInitializer(node.initializer);
      if (isMock) {
        mocks.push({ varName: node.name.text, stubbedReturnValue: stubbedValue });
      } else if (ts.isObjectLiteralExpression(node.initializer)) {
        let hasMockProp = false;
        for (const prop of node.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && prop.initializer) {
            const propRes = checkInitializer(prop.initializer);
            if (propRes.isMock) {
              hasMockProp = true;
              break;
            }
          }
        }
        if (hasMockProp) {
          mocks.push({ varName: node.name.text, isMockObject: true });
        }
      }
    }
    ts.forEachChild(node, walk);
  }

  if (callback.body && ts.isBlock(callback.body)) {
    for (const stmt of callback.body.statements) {
      walk(stmt);
    }
  }

  return mocks;
}

function checkMockTautology(
  callback: ts.FunctionLikeDeclaration,
  sourceFile: ts.SourceFile,
  testName: string,
  fileName?: string,
): AstLinterViolation | undefined {
  const mocks = detectMockDeclarations(callback, sourceFile);
  if (mocks.length === 0) return undefined;

  const mockNames = new Set(mocks.map((m) => m.varName));
  const stubbedValuesMap = new Map<string, string>();
  for (const m of mocks) {
    if (m.stubbedReturnValue !== undefined) {
      stubbedValuesMap.set(m.varName, m.stubbedReturnValue);
    }
  }

  // Check if mock is passed as argument to any non-mock function or class constructor
  let mockExercisedInSut = false;
  const assertions: ts.CallExpression[] = [];

  function inspectNode(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (isAssertionCall(node)) {
        assertions.push(node);
      } else {
        // Non-assertion call
        const isDirectMockCall =
          ts.isIdentifier(node.expression) && mockNames.has(node.expression.text);
        const isDirectMockMethod =
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          mockNames.has(node.expression.expression.text);

        if (!isDirectMockCall && !isDirectMockMethod) {
          // Check if any argument is a mock identifier
          for (const arg of node.arguments) {
            if (ts.isIdentifier(arg) && mockNames.has(arg.text)) {
              mockExercisedInSut = true;
            }
          }
        }
      }
    } else if (ts.isNewExpression(node)) {
      for (const arg of node.arguments ?? []) {
        if (ts.isIdentifier(arg) && mockNames.has(arg.text)) {
          mockExercisedInSut = true;
        }
      }
    }
    ts.forEachChild(node, inspectNode);
  }

  if (callback.body) {
    inspectNode(callback.body);
  }

  // Check 1: Asserting stubbed return value directly: expect(mockFn()).toBe(stubbedValue)
  for (const assertion of assertions) {
    const rootArg = getRootExpectArg(assertion);
    if (rootArg && ts.isCallExpression(rootArg) && ts.isIdentifier(rootArg.expression)) {
      const calledName = rootArg.expression.text;
      const stubbed = stubbedValuesMap.get(calledName);
      if (stubbed !== undefined && assertion.arguments.length > 0) {
        const expectedArg = assertion.arguments[0];
        if (expectedArg && expectedArg.getText(sourceFile) === stubbed) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(assertion.getStart());
          return {
            rule: "mock_tautology",
            message: `Test '${testName}' asserts stubbed mock '${calledName}()' return value (${stubbed}) directly without exercising implementation logic.`,
            file: fileName,
            line: line + 1,
            column: character + 1,
            testName,
            snippet: assertion.getText(sourceFile),
          };
        }
      }
    }
  }

  // Check 2: If mock was never passed to any SUT and all assertions only assert directly on the mock
  if (!mockExercisedInSut && assertions.length > 0) {
    let onlyMockAssertions = true;
    for (const assertion of assertions) {
      const rootArg = getRootExpectArg(assertion);
      if (!rootArg) {
        onlyMockAssertions = false;
        break;
      }
      const rootText = rootArg.getText(sourceFile);
      const targetsMock = Array.from(mockNames).some(
        (name) => rootText === name || rootText.startsWith(`${name}.`) || rootText.startsWith(`${name}(`),
      );
      if (!targetsMock) {
        onlyMockAssertions = false;
        break;
      }
    }

    if (onlyMockAssertions) {
      const firstMock = mocks[0];
      const varName = firstMock ? firstMock.varName : "mock";
      const firstAssert = assertions[0];
      const pos = firstAssert ? firstAssert.getStart() : callback.getStart();
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
      return {
        rule: "mock_tautology",
        message: `Test '${testName}' asserts mock '${varName}' directly without passing it to any implementation under test.`,
        file: fileName,
        line: line + 1,
        column: character + 1,
        testName,
        snippet: firstAssert ? firstAssert.getText(sourceFile) : callback.getText(sourceFile),
      };
    }
  }

  return undefined;
}

export function lintTestAst(sourceCode: string, options?: AstLinterOptions): AstLinterResult {
  const detectEmpty = options?.detectEmptyTests ?? true;
  const detectReturns = options?.detectTrivialReturns ?? true;
  const detectMocks = options?.detectMockTautologies ?? true;
  const detectConstants = options?.detectTrivialConstants ?? true;
  const fileName = typeof options?.file === "string" && options.file.length > 0 ? options.file : "test.ts";

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const testCalls: TestCallInfo[] = [];

  function findTests(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const testInfo = identifyTestCall(node);
      if (testInfo) {
        testCalls.push(testInfo);
      }
    }
    ts.forEachChild(node, findTests);
  }

  findTests(sourceFile);

  const violations: AstLinterViolation[] = [];
  let emptyTestCount = 0;
  let trivialReturnCount = 0;
  let mockTautologyCount = 0;
  let trivialConstantCount = 0;

  for (const { node, testName, callback } of testCalls) {
    // 1. Check for empty test function
    if (detectEmpty) {
      if (!callback.body) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          rule: "empty_test_function",
          message: `Test '${testName}' has no function body.`,
          file: fileName,
          line: line + 1,
          column: character + 1,
          testName,
          snippet: node.getText(sourceFile),
        });
        emptyTestCount++;
        continue;
      } else if (ts.isBlock(callback.body)) {
        if (callback.body.statements.length === 0) {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(callback.body.getStart());
          violations.push({
            rule: "empty_test_function",
            message: `Test '${testName}' has an empty function body.`,
            file: fileName,
            line: line + 1,
            column: character + 1,
            testName,
            snippet: callback.body.getText(sourceFile),
          });
          emptyTestCount++;
          continue;
        }
      }
    }

    // 2. Check for trivial early returns
    if (detectReturns && callback.body && ts.isBlock(callback.body)) {
      let foundAssertionBefore = false;
      let earlyReturnViolation: AstLinterViolation | undefined = undefined;

      for (const stmt of callback.body.statements) {
        // Check if statement contains assertion
        let hasAssertion = false;
        function checkAssertion(n: ts.Node): void {
          if (ts.isCallExpression(n) && isAssertionCall(n)) {
            hasAssertion = true;
          }
          ts.forEachChild(n, checkAssertion);
        }
        checkAssertion(stmt);
        if (hasAssertion) {
          foundAssertionBefore = true;
        }

        // Check if statement is an unconditional return
        if (ts.isReturnStatement(stmt)) {
          if (!foundAssertionBefore) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
            earlyReturnViolation = {
              rule: "trivial_early_return",
              message: `Test '${testName}' returns early on line ${line + 1} before executing any assertions.`,
              file: fileName,
              line: line + 1,
              column: character + 1,
              testName,
              snippet: stmt.getText(sourceFile),
            };
            break;
          }
        }

        // Check if statement is `if (...) return;` before any assertion
        if (ts.isIfStatement(stmt) && !foundAssertionBefore) {
          const thenStmt = stmt.thenStatement;
          if (
            ts.isReturnStatement(thenStmt) ||
            (ts.isBlock(thenStmt) &&
              thenStmt.statements.length === 1 &&
              thenStmt.statements[0] &&
              ts.isReturnStatement(thenStmt.statements[0]))
          ) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(stmt.getStart());
            earlyReturnViolation = {
              rule: "trivial_early_return",
              message: `Test '${testName}' contains conditional early return before any assertions.`,
              file: fileName,
              line: line + 1,
              column: character + 1,
              testName,
              snippet: stmt.getText(sourceFile),
            };
            break;
          }
        }
      }

      if (earlyReturnViolation) {
        violations.push(earlyReturnViolation);
        trivialReturnCount++;
      }
    }

    // 3. Check for trivial constant assertions inside test
    if (detectConstants && callback.body) {
      function scanConstantAssertions(n: ts.Node): void {
        if (ts.isCallExpression(n) && isAssertionCall(n)) {
          const v = checkTrivialConstantAssertion(n, sourceFile, testName, fileName);
          if (v) {
            violations.push(v);
            trivialConstantCount++;
          }
        }
        ts.forEachChild(n, scanConstantAssertions);
      }
      scanConstantAssertions(callback.body);
    }

    // 4. Check for mock tautologies
    if (detectMocks) {
      const mockViolation = checkMockTautology(callback, sourceFile, testName, fileName);
      if (mockViolation) {
        violations.push(mockViolation);
        mockTautologyCount++;
      }
    }
  }

  return {
    passed: violations.length === 0,
    totalTestsAnalyzed: testCalls.length,
    violations,
    emptyTestCount,
    trivialReturnCount,
    mockTautologyCount,
    trivialConstantCount,
  };
}
