import { isAbsolute, resolve } from "node:path";

/**
 * Kind of symbol recognized by the briefing builder anchor extractor.
 */
export type AnchorSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "const"
  | "enum"
  | "method"
  | "property"
  | "other";

/**
 * Symbol metadata extracted from a code source file.
 */
export interface AnchorSymbol {
  readonly name: string;
  readonly kind: AnchorSymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly declarationStartLine?: number | undefined;
  readonly enclosingStartLine?: number | undefined;
  readonly signature?: string | undefined;
  readonly exported?: boolean | undefined;
  readonly docstring?: string | undefined;
}

/**
 * Exact code anchor representing a precise location, line range, and replacement target.
 */
export interface ExactAnchor {
  readonly filePath: string;
  readonly symbolName?: string | undefined;
  readonly symbolKind?: AnchorSymbolKind | undefined;
  readonly startLine: number;
  readonly endLine: number;
  readonly declarationStartLine?: number | undefined;
  readonly enclosingStartLine?: number | undefined;
  readonly contextSnippet: string;
  readonly replacementTarget?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Options for file anchor extraction.
 */
export interface AnchorOptions {
  readonly targetSymbols?: readonly string[] | undefined;
  readonly maxSnippetLines?: number | undefined;
  readonly includeDocstrings?: boolean | undefined;
  readonly includeContext?: boolean | undefined;
  readonly contextLines?: number | undefined;
  readonly baseDir?: string | undefined;
}

/**
 * Compaction options for token budgeting.
 */
export interface CompactionOptions {
  readonly maxTokenBudget?: number | undefined;
  readonly maxSnippetLines?: number | undefined;
  readonly preferSignatures?: boolean | undefined;
}

/**
 * Input options for building a zero-exploration exact-anchor briefing.
 */
export interface ExactAnchorBriefingOptions {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly targetFiles?: readonly string[] | undefined;
  readonly gateCommands?: readonly string[] | undefined;
  readonly acceptanceCriteria?: readonly string[] | undefined;
  readonly promptContext?: string | undefined;
  readonly recommendedCommands?: readonly string[] | undefined;
  readonly targetSymbols?: readonly string[] | undefined;
  readonly baseDir?: string | undefined;
  readonly maxTokenBudget?: number | undefined;
  readonly maxSnippetLines?: number | undefined;
  readonly includeDocstrings?: boolean | undefined;
  readonly preferSignatures?: boolean | undefined;
}

/**
 * Result structure of a zero-exploration exact-anchor briefing.
 */
export interface ExactAnchorBriefing {
  readonly taskId: string;
  readonly label: string;
  readonly markdown: string;
  readonly writeScope: readonly string[];
  readonly targetFiles: readonly string[];
  readonly anchors: readonly ExactAnchor[];
  readonly symbols: readonly AnchorSymbol[];
  readonly gateCommands: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly recommendedCommands: readonly string[];
  readonly waitMsMandate: number;
  readonly estimatedTokens: number;
  readonly isCompacted: boolean;
}

export const TEST_FILE_EXTENSIONS: readonly string[] = [
  ".test.ts",
  ".spec.ts",
  ".test.js",
  ".spec.js",
  ".test.tsx",
  ".spec.tsx",
] as const;

export const TEST_GATE_PREFIXES: readonly string[] = [
  "bun test",
  "npm test",
  "cargo test",
  "pytest",
  "go test",
  "vitest",
] as const;

export const BLOCK_END_DELIMITERS: ReadonlySet<string> = new Set([
  "}",
  "};",
  ");",
  ")",
  "export default",
]);

export function resolveFilePath(filePath: string, baseDir?: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  if (baseDir !== undefined && baseDir.length > 0) {
    return resolve(baseDir, filePath);
  }
  return resolve(process.cwd(), filePath);
}
