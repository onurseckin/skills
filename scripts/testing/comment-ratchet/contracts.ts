export type CommentKind = "line" | "block";

export interface CommentSpan {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly kind: CommentKind;
  readonly text: string;
}

export interface FileCommentMetrics {
  readonly file: string;
  readonly commentLines: number;
  readonly totalComments: number;
  readonly comments: readonly CommentSpan[];
}

export interface CommentBaselineEntry {
  readonly file: string;
  readonly count: number;
  readonly totalComments?: number;
  readonly reason?: string;
}

export interface CommentBaseline {
  readonly schema: string;
  readonly entries: readonly CommentBaselineEntry[];
}

export type CommentRatchetMode = "ratchet" | "strict" | "check";

export type CommentRatchetFormat = "markdown" | "json" | "jsonl";

export interface CommentRatchetDelta {
  readonly file: string;
  readonly observed: number;
  readonly baseline: number;
  readonly diff: number;
}

export interface CommentRatchetDeltaSet {
  readonly added: readonly CommentRatchetDelta[];
  readonly worsened: readonly CommentRatchetDelta[];
  readonly improved: readonly CommentRatchetDelta[];
  readonly unchanged: readonly CommentRatchetDelta[];
  readonly resolved: readonly CommentRatchetDelta[];
}

export interface CommentAuditSnapshot {
  readonly scannedFiles: number;
  readonly totalCommentLines: number;
  readonly totalComments: number;
  readonly files: readonly FileCommentMetrics[];
}

export type CommentAuditPort = () => Promise<CommentAuditSnapshot> | CommentAuditSnapshot;

export interface CommentRatchetOptions {
  readonly repoRoot: string;
  readonly mode: CommentRatchetMode;
  readonly baselinePath?: string | undefined;
  readonly targetFiles?: readonly string[] | undefined;
  readonly audit?: CommentAuditPort | undefined;
  readonly fileLoader?: ((filePath: string) => Promise<string> | string) | undefined;
  readonly fileListLoader?: (() => Promise<readonly string[]> | readonly string[]) | undefined;
}

export interface CommentRatchetReport {
  readonly mode: CommentRatchetMode;
  readonly scannedFiles: number;
  readonly totalCommentLines: number;
  readonly totalComments: number;
  readonly current: readonly CommentBaselineEntry[];
  readonly baselineDelta: CommentRatchetDeltaSet;
  readonly passed: boolean;
}

export interface Flags {
  readonly mode: CommentRatchetMode;
  readonly format: CommentRatchetFormat;
  readonly baselinePath?: string;
  readonly files?: readonly string[];
  readonly staged?: boolean;
}
