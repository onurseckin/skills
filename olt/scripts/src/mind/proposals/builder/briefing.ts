import type {
  ExactAnchorBriefing,
  ExactAnchorBriefingOptions,
  ExactAnchor,
  AnchorSymbol,
} from "./types.ts";
import { extractFileSymbols, extractFileAnchors } from "./anchors.ts";
import { deriveRecommendedTestCommands, formatExactAnchorBriefingMarkdown } from "./formatter.ts";

export function isTargetFilePath(item: string): boolean {
  if (item.includes(".")) {
    return true;
  }
  if (!item.endsWith("/")) {
    return true;
  }
  return false;
}

/**
 * Build a zero-exploration exact-anchor briefing for an assigned task.
 */
export function buildExactAnchorBriefing(options: ExactAnchorBriefingOptions): ExactAnchorBriefing {
  const targetFiles =
    options.targetFiles !== undefined && options.targetFiles.length > 0
      ? options.targetFiles
      : options.writeScope.filter(isTargetFilePath);

  const allAnchors: ExactAnchor[] = [];
  const allSymbols: AnchorSymbol[] = [];

  for (const file of targetFiles) {
    const fileAnchors = extractFileAnchors(file, options.targetSymbols, {
      baseDir: options.baseDir,
    });
    for (const anchor of fileAnchors) {
      allAnchors.push(anchor);
    }

    const fileSymbols = extractFileSymbols(file, options.targetSymbols, options.baseDir);
    for (const sym of fileSymbols) {
      allSymbols.push(sym);
    }
  }

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
    anchors: allAnchors,
    symbols: allSymbols,
    gateCommands,
    acceptanceCriteria,
    recommendedCommands,
    waitMsMandate: 10000,
  };

  const markdown = formatExactAnchorBriefingMarkdown(baseBriefing);

  return {
    ...baseBriefing,
    markdown,
  };
}
