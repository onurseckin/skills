import type {
  ExactAnchorBriefing,
  ExactAnchorBriefingOptions,
  ExactAnchor,
  AnchorSymbol,
} from "./types.ts";
import { extractFileSymbols, extractFileAnchors } from "./anchors.ts";
import { deriveRecommendedTestCommands, formatExactAnchorBriefingMarkdown } from "./formatter.ts";
import { expandWriteScope } from "./discovery.ts";
import { applyTokenEconomy } from "./compaction.ts";

export type {
  AnchorSymbol,
  AnchorSymbolKind,
  ExactAnchor,
  AnchorOptions,
  CompactionOptions,
  ExactAnchorBriefingOptions,
  ExactAnchorBriefing,
} from "./types.ts";

export {
  TEST_FILE_EXTENSIONS,
  TEST_GATE_PREFIXES,
  BLOCK_END_DELIMITERS,
  resolveFilePath,
} from "./types.ts";

export {
  extractFileAnchors,
  extractFileSymbols,
  createDropInAnchor,
  findAnchorByPattern,
} from "./anchors.ts";

export { extractSymbolsFromSource } from "./symbols.ts";
export { escapeRegExp, findBalancedBlock } from "./scanner.ts";
export { expandWriteScope, isTargetFilePath } from "./discovery.ts";
export { deriveRecommendedTestCommands, formatExactAnchorBriefingMarkdown } from "./formatter.ts";
export { estimateTokens, compactSnippet, compactAnchor, applyTokenEconomy } from "./compaction.ts";

/**
 * Build a zero-exploration exact-anchor briefing for an assigned task.
 */
export function buildExactAnchorBriefing(options: ExactAnchorBriefingOptions): ExactAnchorBriefing {
  const targetFiles =
    options.targetFiles !== undefined && options.targetFiles.length > 0
      ? options.targetFiles
      : expandWriteScope(options.writeScope, options.baseDir);

  const rawAnchors: ExactAnchor[] = [];
  const rawSymbols: AnchorSymbol[] = [];

  for (const file of targetFiles) {
    const fileAnchors = extractFileAnchors(file, options.targetSymbols, {
      baseDir: options.baseDir,
      maxSnippetLines: options.maxSnippetLines,
      includeDocstrings: options.includeDocstrings,
    });
    for (const anchor of fileAnchors) {
      rawAnchors.push(anchor);
    }

    const fileSymbols = extractFileSymbols(file, options.targetSymbols, options.baseDir);
    for (const sym of fileSymbols) {
      rawSymbols.push(sym);
    }
  }

  const compaction = applyTokenEconomy(
    rawAnchors,
    rawSymbols,
    options.maxTokenBudget ?? 4000,
    options.maxSnippetLines ?? 20,
    options.preferSignatures ?? false,
    options.targetSymbols,
  );

  const gateCommands = options.gateCommands !== undefined ? options.gateCommands : [];
  const recommendedCommands =
    options.recommendedCommands !== undefined && options.recommendedCommands.length > 0
      ? options.recommendedCommands
      : deriveRecommendedTestCommands(targetFiles, gateCommands, options.baseDir);

  const defaultCriteria: string[] = [
    `Strict type safety: 0 'any' types, 0 compiler suppressions (${"@"}ts-ignore, ${"@"}ts-expect-error, eslint-disable).`,
    `Strict disjoint write scope: Only modify files in assigned write scope (${options.writeScope.join(", ")}).`,
    `All verification commands pass cleanly with exit code 0.`,
    `Mandate WaitMsBeforeAsync: 10000 on all run_command invocations.`,
  ];

  const acceptanceCriteria =
    options.acceptanceCriteria !== undefined && options.acceptanceCriteria.length > 0
      ? options.acceptanceCriteria
      : defaultCriteria;

  const baseBriefing = {
    taskId: options.taskId,
    label: options.label,
    writeScope: options.writeScope,
    targetFiles,
    anchors: compaction.anchors,
    symbols: compaction.symbols,
    gateCommands,
    acceptanceCriteria,
    recommendedCommands,
    waitMsMandate: 10000,
    estimatedTokens: compaction.estimatedTokens,
    isCompacted: compaction.isCompacted,
  };

  const markdown = formatExactAnchorBriefingMarkdown(baseBriefing);

  return {
    ...baseBriefing,
    markdown,
  };
}
