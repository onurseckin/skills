import type {
  MutantExecutionResult,
  MutantRecord,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
  MutationType,
  MutationViolation,
} from "../anti-mock/anti-mock-types.ts";

export type {
  MutantExecutionResult,
  MutantRecord,
  MutationGateOptions,
  MutationGateResult,
  MutationTestRunner,
  MutationType,
  MutationViolation,
};

export interface MutationCandidate {
  readonly mutationType: MutationType;
  readonly description: string;
  readonly startPosition: number;
  readonly endPosition: number;
  readonly originalText: string;
  readonly replacementText: string;
  readonly line: number;
  readonly column: number;
}
