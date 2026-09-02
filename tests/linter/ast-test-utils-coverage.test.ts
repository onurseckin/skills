import { describe, expect, it } from "bun:test";
import ts from "typescript";
import {
  ASSERTION_NAMES,
  detectMockDeclarations,
  EQUALITY_MATCHERS,
  extractTestName,
  findCallback,
  getRootExpectArg,
  identifyTestCall,
  isAssertionCall,
  isLiteralOrConstant,
  isTestIdentifier,
  isTestPropertyTarget,
  isTrivialLiteralMatch,
  LITERAL_SYNTAX_KINDS,
  matchesMockTarget,
  MOCK_FACTORIES,
  MOCK_FRAMEWORK_NAMES,
  MOCK_RETURN_PROPS,
  TEST_IDENTIFIERS,
} from "../../olt/scripts/src/linter/ast/test-utils.ts";

function parseSnippet(code: string): ts.SourceFile {
  return ts.createSourceFile("sample.test.ts", code, ts.ScriptTarget.Latest, true);
}

function findFirstCall(sourceFile: ts.SourceFile): ts.CallExpression {
  let call: ts.CallExpression | undefined;
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && !call) {
      call = node;
      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  if (!call) throw new Error("No call expression found");
  return call;
}

describe("ast test-utils coverage suite", () => {
  describe("exported constants and sets", () => {
    it("contains expected identifiers, matchers, and syntax kinds", () => {
      expect(TEST_IDENTIFIERS.has("test")).toBe(true);
      expect(TEST_IDENTIFIERS.has("it")).toBe(true);
      expect(MOCK_FACTORIES.has("fn")).toBe(true);
      expect(MOCK_RETURN_PROPS.has("mockReturnValue")).toBe(true);
      expect(MOCK_FRAMEWORK_NAMES.has("vi")).toBe(true);
      expect(ASSERTION_NAMES.has("expect")).toBe(true);
      expect(EQUALITY_MATCHERS.has("toBe")).toBe(true);
      expect(LITERAL_SYNTAX_KINDS.has(ts.SyntaxKind.NumericLiteral)).toBe(true);
    });
  });

  describe("isTestIdentifier and isTestPropertyTarget", () => {
    it("identifies test names and property target hierarchies", () => {
      expect(isTestIdentifier("test")).toBe(true);
      expect(isTestIdentifier("it")).toBe(true);
      expect(isTestIdentifier("describe")).toBe(false);

      const sf = parseSnippet(
        "it.only(); describe.test(); describe.skip(); custom.test(); describe.test.only(); (a ? b : c)();",
      );
      const stmts = sf.statements as ts.NodeArray<ts.ExpressionStatement>;
      const getExpr = (idx: number) =>
        (stmts[idx].expression as ts.CallExpression).expression as ts.PropertyAccessExpression;

      expect(isTestPropertyTarget(getExpr(0).expression, getExpr(0).name.text)).toBe(true);
      expect(isTestPropertyTarget(getExpr(1).expression, getExpr(1).name.text)).toBe(true);
      expect(isTestPropertyTarget(getExpr(2).expression, getExpr(2).name.text)).toBe(false);
      expect(isTestPropertyTarget(getExpr(3).expression, getExpr(3).name.text)).toBe(false);
      expect(isTestPropertyTarget(getExpr(4).expression, getExpr(4).name.text)).toBe(true);
      expect(
        isTestPropertyTarget((stmts[5].expression as ts.CallExpression).expression, "only"),
      ).toBe(false);
    });
  });

  describe("extractTestName and findCallback", () => {
    it("extracts names from literals, templates, and handles anonymous fallbacks", () => {
      const sf = parseSnippet(
        "test('str', () => {}); test(`tmpl`, () => {}); test(`sub ${x}`, () => {}); test(42, () => {});",
      );
      const calls = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression as ts.CallExpression,
      );

      expect(extractTestName(calls[0].arguments)).toBe("str");
      expect(extractTestName(calls[1].arguments)).toBe("tmpl");
      expect(extractTestName(calls[2].arguments)).toBe("`sub ${x}`");
      expect(extractTestName(calls[3].arguments)).toBe("<anonymous test>");
      expect(extractTestName(ts.factory.createNodeArray())).toBe("<anonymous test>");
    });

    it("locates arrow functions and function expressions or returns undefined", () => {
      const sf = parseSnippet("test('a', () => {}); test('b', function() {}); test('c', 123);");
      const calls = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression as ts.CallExpression,
      );

      expect(findCallback(calls[0].arguments)).toBeDefined();
      expect(findCallback(calls[1].arguments)).toBeDefined();
      expect(findCallback(calls[2].arguments)).toBeUndefined();
    });
  });

  describe("identifyTestCall", () => {
    it("identifies direct calls, property access, and .each chains", () => {
      const sf = parseSnippet(`
        test('unit a', () => {});
        test('no callback');
        custom('ignored', () => {});
        test.skip('unit b', () => {});
        test.skip('no callback prop');
        it.each([1, 2])('unit c %s', (x) => {});
        test.each([1, 2])('no callback each');
        other()();
      `);
      const calls = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression as ts.CallExpression,
      );

      expect(identifyTestCall(calls[0])?.testName).toBe("unit a");
      expect(identifyTestCall(calls[1])).toBeUndefined();
      expect(identifyTestCall(calls[2])).toBeUndefined();
      expect(identifyTestCall(calls[3])?.testName).toBe("unit b");
      expect(identifyTestCall(calls[4])).toBeUndefined();
      expect(identifyTestCall(calls[5])?.testName).toBe("unit c %s");
      expect(identifyTestCall(calls[6])).toBeUndefined();
      expect(identifyTestCall(calls[7])).toBeUndefined();
    });
  });

  describe("isLiteralOrConstant", () => {
    it("identifies literals, constants, and prefix unary numbers", () => {
      const sf = parseSnippet(
        "true; false; null; 42; 'txt'; `no-sub`; [1]; ({ a: 1 }); undefined; NaN; myVar; -10; !flag; 1 + 2;",
      );
      const exprs = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression,
      );

      expect(isLiteralOrConstant(exprs[0])).toBe(true);
      expect(isLiteralOrConstant(exprs[1])).toBe(true);
      expect(isLiteralOrConstant(exprs[2])).toBe(true);
      expect(isLiteralOrConstant(exprs[3])).toBe(true);
      expect(isLiteralOrConstant(exprs[4])).toBe(true);
      expect(isLiteralOrConstant(exprs[5])).toBe(true);
      expect(isLiteralOrConstant(exprs[6])).toBe(true);
      expect(isLiteralOrConstant((exprs[7] as ts.ParenthesizedExpression).expression)).toBe(true);
      expect(isLiteralOrConstant(exprs[8])).toBe(true);
      expect(isLiteralOrConstant(exprs[9])).toBe(true);
      expect(isLiteralOrConstant(exprs[10])).toBe(false);
      expect(isLiteralOrConstant(exprs[11])).toBe(true);
      expect(isLiteralOrConstant(exprs[12])).toBe(false);
      expect(isLiteralOrConstant(exprs[13])).toBe(false);
    });
  });

  describe("isAssertionCall and getRootExpectArg", () => {
    it("detects assertion calls and extracts expect root expressions across complex chains", () => {
      const sf = parseSnippet(`
        expect(t1);
        assert(t2);
        t(t3);
        expect(vA).toBe(1);
        expect(vB).not.toEqual(2);
        expect(vC).resolves.toBe(3);
        assert.strictEqual(a, b);
        t.is(a, b);
        calc(vD);
        foo().bar();
        (cond ? a : b)();
      `);
      const calls = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression as ts.CallExpression,
      );

      expect(isAssertionCall(calls[0])).toBe(true);
      expect(isAssertionCall(calls[1])).toBe(true);
      expect(isAssertionCall(calls[2])).toBe(true);
      expect(isAssertionCall(calls[3])).toBe(true);
      expect(isAssertionCall(calls[4])).toBe(true);
      expect(isAssertionCall(calls[5])).toBe(true);
      expect(isAssertionCall(calls[6])).toBe(true);
      expect(isAssertionCall(calls[7])).toBe(true);
      expect(isAssertionCall(calls[8])).toBe(false);
      expect(isAssertionCall(calls[9])).toBe(false);
      expect(isAssertionCall(calls[10])).toBe(false);

      expect(getRootExpectArg(calls[0])?.getText(sf)).toBe("t1");
      expect(getRootExpectArg(calls[3])?.getText(sf)).toBe("vA");
      expect(getRootExpectArg(calls[4])?.getText(sf)).toBe("vB");
      expect(getRootExpectArg(calls[5])?.getText(sf)).toBe("vC");
      expect(getRootExpectArg(calls[6])).toBeUndefined();
      expect(getRootExpectArg(calls[10])).toBeUndefined();
    });
  });

  describe("detectMockDeclarations", () => {
    it("detects mocks across factories, properties, return stubs, and mock objects", () => {
      const sf = parseSnippet(`
        test('mock suite', () => {
          const m1 = mock();
          const m2 = vi.fn();
          const m3 = jest.fn();
          const m4 = vi.spyOn(obj, 'act');
          const m5 = mock().mockReturnValue(42);
          const m6 = mock().mockResolvedValue('ok');
          const m7 = vi.fn().mockImplementation(() => 99);
          const m8 = mock(() => 100);
          const m9 = mock(() => { return 200; });
          const m10 = mock(function() { return 300; });
          const m11 = vi.fn;
          const m12 = jest.spyOn;
          const m13 = vi.mock('pkg');
          const m14 = mock(456);
          const m15 = custom.fn();
          const svc = { query: mock(), send: vi.fn, save: vi.spyOn };
          const plain = { a: 1 };
          const x = 500;
        });
      `);
      const testCall = findFirstCall(sf);
      const callback = findCallback(testCall.arguments)!;
      const mocks = detectMockDeclarations(callback, sf);

      expect(mocks.some((m) => m.varName === "m1")).toBe(true);
      expect(mocks.some((m) => m.varName === "m2")).toBe(true);
      expect(mocks.some((m) => m.varName === "m3")).toBe(true);
      expect(mocks.some((m) => m.varName === "m4")).toBe(true);
      expect(mocks.find((m) => m.varName === "m5")?.stubbedReturnValue).toBe("42");
      expect(mocks.find((m) => m.varName === "m6")?.stubbedReturnValue).toBe("'ok'");
      expect(mocks.some((m) => m.varName === "m7")).toBe(true);
      expect(mocks.find((m) => m.varName === "m8")?.stubbedReturnValue).toBe("100");
      expect(mocks.find((m) => m.varName === "m9")?.stubbedReturnValue).toBeUndefined();
      expect(mocks.find((m) => m.varName === "m10")?.stubbedReturnValue).toBeUndefined();
      expect(mocks.some((m) => m.varName === "m13")).toBe(true);
      expect(mocks.find((m) => m.varName === "svc")?.isMockObject).toBe(true);
      expect(mocks.some((m) => m.varName === "plain")).toBe(false);
      expect(mocks.some((m) => m.varName === "x")).toBe(false);

      const emptyCb = ts.factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        ts.factory.createNumericLiteral(1),
      );
      expect(detectMockDeclarations(emptyCb, sf)).toEqual([]);
    });
  });

  describe("matchesMockTarget and isTrivialLiteralMatch", () => {
    it("matches mock targets and trivial literal assertions", () => {
      expect(matchesMockTarget("myMock", "myMock")).toBe(true);
      expect(matchesMockTarget("myMock.action", "myMock")).toBe(true);
      expect(matchesMockTarget("myMock(10)", "myMock")).toBe(true);
      expect(matchesMockTarget("myMockExtra", "myMock")).toBe(false);
      expect(matchesMockTarget("other", "myMock")).toBe(false);

      const sf = parseSnippet("true; false; null; undefined; NaN; 42;");
      const exprs = (sf.statements as ts.NodeArray<ts.ExpressionStatement>).map(
        (s) => s.expression,
      );

      expect(isTrivialLiteralMatch("toBeTruthy", exprs[0])).toBe(true);
      expect(isTrivialLiteralMatch("toBeTruthy", exprs[1])).toBe(false);
      expect(isTrivialLiteralMatch("toBeFalsy", exprs[1])).toBe(true);
      expect(isTrivialLiteralMatch("toBeNull", exprs[2])).toBe(true);
      expect(isTrivialLiteralMatch("toBeUndefined", exprs[3])).toBe(true);
      expect(isTrivialLiteralMatch("toBeNaN", exprs[4])).toBe(true);
      expect(isTrivialLiteralMatch("toBeNaN", exprs[5])).toBe(false);
      expect(isTrivialLiteralMatch("toBe", exprs[0])).toBe(false);
    });
  });
});
