export type {
  CommentAuditPort,
  CommentAuditSnapshot,
  CommentBaseline,
  CommentBaselineEntry,
  CommentKind,
  CommentRatchetDelta,
  CommentRatchetDeltaSet,
  CommentRatchetFormat,
  CommentRatchetMode,
  CommentRatchetOptions,
  CommentRatchetReport,
  CommentSpan,
  FileCommentMetrics,
  Flags,
} from "./contracts.ts";

export {
  COMMENT_BASELINE_SCHEMA,
  DEFAULT_COMMENT_BASELINE,
  assertInsideRepository,
  baselineFailure,
  compareBaselineEntries,
  loadCommentBaseline,
  parseBaseline,
  serializeBaseline,
} from "./baseline.ts";

export { compareCommentBaseline } from "./compare.ts";

export { carryOverReasons, checkCommentRatchet, runCommentAudit } from "./engine.ts";

export { renderJsonlBaseline, renderJsonReport, renderMarkdownReport } from "./report.ts";

export { type ScannedCommentsResult, scanCommentsInSource, scanFileComments } from "./scanner.ts";

export { type CommentRatchetCliPorts, getStagedFiles, main, parseFlags, runCli } from "./cli.ts";
