export type {
  CheckReport,
  ModularityMode,
  ScanSource,
  ScopeDecision,
  Violation,
  ViolationRule,
} from "./contracts.ts";
export { assertRepositoryRelativePosixPath, ModularityScopeError } from "./errors.ts";
export { assertRootConvention, classifyPath } from "./scope.ts";
