import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { AnchorSymbol, ExactAnchor, AnchorOptions } from "./types.ts";
import { resolveFilePath, BLOCK_END_DELIMITERS } from "./types.ts";
import { extractSymbolsFromSource } from "./symbols.ts";

export function extractFileSymbols(
  filePath: string,
  targetSymbols?: readonly string[],
  baseDir?: string,
): readonly AnchorSymbol[] {
  const fullPath = resolveFilePath(filePath, baseDir);
  if (!existsSync(fullPath)) {
    return [];
  }
  try {
    if (statSync(fullPath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const content = readFileSync(fullPath, "utf-8");
  const allSymbols = extractSymbolsFromSource(content, basename(filePath));

  if (targetSymbols === undefined || targetSymbols.length === 0) {
    return allSymbols;
  }

  const targetSet = new Set(targetSymbols);
  const targetLower = new Set(targetSymbols.map((s: string): string => s.toLowerCase()));

  return allSymbols.filter((sym: AnchorSymbol): boolean => {
    if (targetSet.has(sym.name)) {
      return true;
    }
    const dotPart = sym.name.split(".").pop();
    if (dotPart !== undefined && targetSet.has(dotPart)) {
      return true;
    }
    if (targetLower.has(sym.name.toLowerCase())) {
      return true;
    }
    return false;
  });
}

/**
 * Create a drop-in replacement anchor for an explicit range of code.
 */
export function createDropInAnchor(
  filePath: string,
  startLine: number,
  endLine: number,
  replacementTarget: string,
  description?: string,
): ExactAnchor {
  return {
    filePath,
    startLine,
    endLine,
    contextSnippet: replacementTarget,
    replacementTarget,
    description:
      description !== undefined
        ? description
        : `Drop-in replacement for lines ${startLine}–${endLine}`,
  };
}

/**
 * Find an exact anchor by regex or string search pattern in a file.
 */
export function findAnchorByPattern(
  filePath: string,
  pattern: RegExp | string,
  baseDir?: string,
): ExactAnchor | undefined {
  const fullPath = resolveFilePath(filePath, baseDir);
  if (!existsSync(fullPath)) {
    return undefined;
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && regex.test(line)) {
      const startLine = i + 1;
      let endLine = startLine;
      let j = i;
      while (j < lines.length && j < i + 20) {
        const nextLine = lines[j];
        if (nextLine !== undefined && BLOCK_END_DELIMITERS.has(nextLine.trim())) {
          endLine = j + 1;
          break;
        }
        j++;
      }
      if (endLine === startLine && i + 5 <= lines.length) {
        endLine = Math.min(lines.length, i + 5);
      }
      const slice = lines.slice(startLine - 1, endLine);
      const text = slice.join("\n");
      const patternStr = typeof pattern === "string" ? pattern : pattern.source;
      return {
        filePath,
        startLine,
        endLine,
        contextSnippet: text,
        replacementTarget: text,
        description: `Pattern match anchor for ${patternStr} (lines ${startLine}–${endLine})`,
      };
    }
  }
  return undefined;
}

/**
 * Extract exact code anchors from a target file.
 * Returns exact line ranges, symbol locations, and replacement targets.
 */
export function extractFileAnchors(
  filePath: string,
  targetSymbols?: readonly string[],
  options?: AnchorOptions,
): readonly ExactAnchor[] {
  const baseDir = options !== undefined ? options.baseDir : undefined;
  const fullPath = resolveFilePath(filePath, baseDir);

  if (!existsSync(fullPath)) {
    return [];
  }
  try {
    if (statSync(fullPath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const maxLines =
    options !== undefined && options.maxSnippetLines !== undefined ? options.maxSnippetLines : 20;

  let effectiveTargets: readonly string[] | undefined = undefined;
  if (targetSymbols !== undefined && targetSymbols.length > 0) {
    effectiveTargets = targetSymbols;
  } else if (options !== undefined && options.targetSymbols !== undefined) {
    effectiveTargets = options.targetSymbols;
  }

  const symbols = extractFileSymbols(filePath, effectiveTargets, baseDir);
  const anchors: ExactAnchor[] = [];

  if (symbols.length > 0) {
    for (const sym of symbols) {
      const startLine = Math.max(1, sym.startLine);
      const endLine = Math.min(lines.length, Math.max(startLine, sym.endLine));
      const snippetLines = lines.slice(startLine - 1, endLine);
      const replacementTarget = snippetLines.join("\n");

      let contextSnippet = replacementTarget;
      if (snippetLines.length > maxLines) {
        const preview = snippetLines.slice(0, maxLines - 5).join("\n");
        contextSnippet = `${preview}\n// ... (${snippetLines.length - (maxLines - 5)} more lines)`;
      }

      anchors.push({
        filePath,
        symbolName: sym.name,
        symbolKind: sym.kind,
        startLine,
        endLine,
        contextSnippet,
        replacementTarget,
        description: `${sym.kind} \`${sym.name}\` (lines ${startLine}–${endLine})`,
      });
    }
    return anchors;
  }

  // If specific target symbols were requested but not matched in AST, try pattern matching
  if (effectiveTargets !== undefined && effectiveTargets.length > 0) {
    for (const target of effectiveTargets) {
      const patternAnchor = findAnchorByPattern(filePath, target, baseDir);
      if (patternAnchor !== undefined) {
        anchors.push(patternAnchor);
      }
    }
    if (anchors.length > 0) {
      return anchors;
    }
  }

  // Fallback for files without matched symbols: anchor the whole file or initial block
  if (lines.length > 0) {
    const endLine = lines.length;
    const snippet =
      lines.length > maxLines
        ? `${lines.slice(0, maxLines - 5).join("\n")}\n// ... (${lines.length - (maxLines - 5)} more lines)`
        : content;

    anchors.push({
      filePath,
      startLine: 1,
      endLine,
      contextSnippet: snippet,
      replacementTarget: content,
      description: `File anchor for ${filePath} (lines 1–${endLine})`,
    });
  }

  return anchors;
}
