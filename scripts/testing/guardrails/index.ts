/**
 * @file index.ts
 * Public entry point for testing guardrails module.
 * Explicit named exports only (zero export *).
 */

export { auditSourceCode } from "./ast-checker.ts";

export {
  auditTestPurity,
  auditTestPuritySync,
  computeIsMain,
  getAllTestFiles,
  getStagedTestFiles,
  resolveAuditRequest,
  main as runPurityGuardMain,
} from "./purity-guard.ts";

export {
  buildAuditResult,
  describeVacuity,
  formatMarkdownReport,
  formatTerminalReport,
} from "./reporter.ts";

export {
  createViolation,
  HEAVY_AST_METHODS,
  PROHIBITED_CP_METHODS,
  PROHIBITED_FS_METHODS,
  PROHIBITED_FS_MODULES,
  PROHIBITED_SUBPROCESS_METHODS,
  REPO_PATH_REGEX,
  VIRTUAL_RECEIVER_REGEX,
} from "./rules-config.ts";

export type {
  PurityAuditOptions,
  PurityAuditRequest,
  PurityAuditResult,
  PurityAuditScope,
  PurityViolation,
  PurityViolationCategory,
} from "./types.ts";
