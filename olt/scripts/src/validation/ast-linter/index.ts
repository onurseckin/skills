export type {
  AstLinterOptions,
  AstLinterResult,
  AstLinterViolation,
  MockInfo,
  TestCallInfo,
} from "./types.ts";

export {
  MOCK_FACTORIES,
  TEST_IDENTIFIERS,
  extractTestName,
  findCallback,
  getRootExpectArg,
  identifyTestCall,
  isAssertionCall,
  isLiteralOrConstant,
  isTestIdentifier,
} from "./types.ts";

export {
  checkTrivialConstantAssertion,
} from "./assertion-detectors.ts";

export {
  checkMockTautology,
  detectMockDeclarations,
} from "./mock-detectors.ts";

export {
  lintTestAst,
} from "./visitor.ts";
