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
  stripGitCommentary,
} from "./commit-msg-guard.ts";
