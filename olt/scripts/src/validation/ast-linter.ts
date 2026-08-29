export type {
  AstLinterOptions,
  AstLinterResult,
  AstLinterViolation,
  MockInfo,
  TestCallInfo,
} from "./ast-linter/index.ts";

export {
  MOCK_FACTORIES,
  TEST_IDENTIFIERS,
  checkMockTautology,
  checkTrivialConstantAssertion,
  detectMockDeclarations,
  extractTestName,
  findCallback,
  getRootExpectArg,
  identifyTestCall,
  isAssertionCall,
  isLiteralOrConstant,
  isTestIdentifier,
  lintTestAst,
} from "./ast-linter/index.ts";
