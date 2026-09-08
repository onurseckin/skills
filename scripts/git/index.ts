export {
  AI_VENDOR_PATTERN,
  ATTRIBUTION_TRAILER_KEYS,
  type AttributionRule,
  type AttributionViolation,
  auditCommitMessage,
  type CommitMessageAudit,
  computeIsMain,
  FORBIDDEN_TRAILER_KEYS,
  formatViolationReport,
  main,
  runCommitMsgGuard,
} from "./commit-msg-guard.ts";
export {
  FAIL_CLOSED_ERROR_MESSAGE,
  STANDARD_HOOK_NAMES,
  buildGitHookTemplate,
  computeIsHookTemplateMain,
  hardenGitHooksDirectory,
  hardenHookFile,
  hardenHookScript,
  installGitHook,
  isHookFailingClosed,
  runHookHardener,
} from "./hook-template.ts";
export { computeIsHardenHooksMain, executeHardenHooksCli } from "./harden-hooks.ts";
