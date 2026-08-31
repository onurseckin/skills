import type { AnchorSymbol, ExactAnchor } from "./types.ts";

/**
 * Estimate the token count of a given string (approx 3.8 chars per token + newlines).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  const charEstimate = Math.ceil(text.length / 3.8);
  return Math.max(wordCount, charEstimate);
}

/**
 * Compact a code snippet to fit within a target line limit.
 */
export function compactSnippet(snippet: string, maxLines = 20, preferSignatures = false): string {
  const lines = snippet.split(/\r?\n/);
  if (lines.length <= maxLines && !preferSignatures) {
    return snippet;
  }

  if (preferSignatures && lines.length > 2) {
    const sigLine = lines[0] ?? "";
    return `${sigLine} { /* ... body truncated for brevity ... */ }`;
  }

  const headCount = Math.max(2, Math.floor(maxLines * 0.6));
  const tailCount = Math.max(1, maxLines - headCount - 1);
  const head = lines.slice(0, headCount);
  const tail = lines.slice(lines.length - tailCount);
  const omitted = lines.length - headCount - tailCount;

  return [...head, `// ... (${omitted} more lines truncated for brevity) ...`, ...tail].join("\n");
}

export function compactAnchor(
  anchor: ExactAnchor,
  maxSnippetLines = 20,
  preferSignatures = false,
): ExactAnchor {
  const contextSnippet = compactSnippet(anchor.contextSnippet, maxSnippetLines, preferSignatures);
  return {
    ...anchor,
    contextSnippet,
  };
}

export interface CompactionResult {
  readonly anchors: readonly ExactAnchor[];
  readonly symbols: readonly AnchorSymbol[];
  readonly isCompacted: boolean;
  readonly estimatedTokens: number;
}

function getSymbolPriority(sym: AnchorSymbol, targetSet: ReadonlySet<string>): number {
  if (targetSet.has(sym.name)) return 100;
  if (sym.exported) {
    if (
      sym.kind === "interface" ||
      sym.kind === "type" ||
      sym.kind === "class" ||
      sym.kind === "function"
    ) {
      return 80;
    }
    if (sym.kind === "method" || sym.kind === "property") return 60;
    return 50;
  }
  if (sym.kind === "function" || sym.kind === "class") return 30;
  return 10;
}

function getAnchorPriority(anchor: ExactAnchor, targetSet: ReadonlySet<string>): number {
  if (anchor.symbolName !== undefined && targetSet.has(anchor.symbolName)) return 100;
  if (anchor.symbolName !== undefined) return 70;
  if (!anchor.filePath.includes(".test.") && !anchor.filePath.includes(".spec.")) return 50;
  return 30;
}

/**
 * Dynamically compacts anchors and symbols to strictly respect the max token budget
 * using semantic priority ranking.
 */
export function applyTokenEconomy(
  anchors: readonly ExactAnchor[],
  symbols: readonly AnchorSymbol[],
  maxBudgetTokens = 4000,
  maxSnippetLines = 20,
  preferSignatures = false,
  targetSymbols?: readonly string[],
): CompactionResult {
  const targetSet = new Set(targetSymbols ?? []);

  let compactedAnchors = anchors.map((a) => compactAnchor(a, maxSnippetLines, preferSignatures));
  let compactedSymbols = [...symbols];
  let isCompacted = preferSignatures;

  let currentTokens =
    estimateTokens(compactedAnchors.map((a) => a.contextSnippet).join("\n")) +
    estimateTokens(compactedSymbols.map((s) => s.signature ?? s.name).join(" "));

  if (currentTokens > maxBudgetTokens) {
    isCompacted = true;
    // Aggressive pass: reduce snippet limit to 4 lines with signature preference
    compactedAnchors = anchors.map((a) => compactAnchor(a, 4, true));
    currentTokens =
      estimateTokens(compactedAnchors.map((a) => a.contextSnippet).join("\n")) +
      estimateTokens(compactedSymbols.map((s) => s.signature ?? s.name).join(" "));
  }

  if (currentTokens > maxBudgetTokens) {
    // Sort by semantic priority before truncation so essential targets are kept
    compactedAnchors.sort(
      (a, b) => getAnchorPriority(b, targetSet) - getAnchorPriority(a, targetSet),
    );
    compactedSymbols.sort(
      (a, b) => getSymbolPriority(b, targetSet) - getSymbolPriority(a, targetSet),
    );

    const maxAnchorCount = Math.max(
      3,
      Math.floor(anchors.length * (maxBudgetTokens / currentTokens)),
    );
    compactedAnchors = compactedAnchors.slice(0, maxAnchorCount);
    const maxSymbolCount = Math.max(
      5,
      Math.floor(symbols.length * (maxBudgetTokens / currentTokens)),
    );
    compactedSymbols = compactedSymbols.slice(0, maxSymbolCount);

    currentTokens =
      estimateTokens(compactedAnchors.map((a) => a.contextSnippet).join("\n")) +
      estimateTokens(compactedSymbols.map((s) => s.signature ?? s.name).join(" "));
  }

  return {
    anchors: compactedAnchors,
    symbols: compactedSymbols,
    isCompacted,
    estimatedTokens: currentTokens,
  };
}
