export type { CandidateAdder } from "./expression-mutators.ts";

export { visitBinaryExpressions, visitBooleanAndUnary } from "./expression-mutators.ts";

export {
  shouldSkipStringLiteral,
  visitFunctionBodies,
  visitReturnStatements,
  visitStringLiterals,
} from "./statement-mutators.ts";
