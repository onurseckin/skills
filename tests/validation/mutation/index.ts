/**
 * Mutation Facade.
 */
export {
  generateMutants,
  shouldSkipStringLiteral,
  isSyntaxOrCompilationError,
  runMutationGate,
} from "../../../olt/scripts/src/validation/mutation-gate/index.ts";

export type {
  MutantExecutionResult,
  MutantRecord,
  MutationCandidate,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
  MutationType,
  MutationViolation,
} from "../../../olt/scripts/src/validation/mutation-gate/index.ts";
