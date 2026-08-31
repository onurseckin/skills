import { BLOCK_END_DELIMITERS } from "./types.ts";

/**
 * Safe regular expression escaping and depth-aware code block scanning.
 */
export function escapeRegExp(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface BlockBoundary {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

/**
 * Scan forward from a matching line to find the complete balanced code block.
 * Correctly accounts for nested braces, string literals, and comments.
 */
export function findBalancedBlock(
  lines: readonly string[],
  startLineIndex: number,
  maxScanLines = 150,
): BlockBoundary {
  const startLine = startLineIndex + 1;
  let braceDepth = 0;
  let hasOpenedBrace = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inMultiComment = false;

  const maxIndex = Math.min(lines.length, startLineIndex + maxScanLines);

  for (let i = startLineIndex; i < maxIndex; i++) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }

    if (!hasOpenedBrace && BLOCK_END_DELIMITERS.has(line.trim())) {
      const endLine = i + 1;
      const slice = lines.slice(startLineIndex, endLine);
      return {
        startLine,
        endLine,
        text: slice.join("\n"),
      };
    }

    let escaped = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const nextCh = c + 1 < line.length ? line[c + 1] : "";

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (inMultiComment) {
        if (ch === "*" && nextCh === "/") {
          inMultiComment = false;
          c++;
        }
        continue;
      }

      if (inSingleQuote) {
        if (ch === "'") inSingleQuote = false;
        continue;
      }
      if (inDoubleQuote) {
        if (ch === '"') inDoubleQuote = false;
        continue;
      }
      if (inTemplate) {
        if (ch === "`") inTemplate = false;
        continue;
      }

      if (ch === "/" && nextCh === "*") {
        inMultiComment = true;
        c++;
        continue;
      }
      if (ch === "/" && nextCh === "/") {
        break; // Ignore the rest of the line
      }

      if (ch === "'") {
        inSingleQuote = true;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }

      if (ch === "{") {
        braceDepth++;
        hasOpenedBrace = true;
      } else if (ch === "}") {
        braceDepth--;
        if (hasOpenedBrace && braceDepth <= 0) {
          // Reached closing delimiter of top-level block
          const endLine = i + 1;
          const slice = lines.slice(startLineIndex, endLine);
          return {
            startLine,
            endLine,
            text: slice.join("\n"),
          };
        }
      } else if (ch === ";" && !hasOpenedBrace) {
        // Early exit on semicolon-terminated single statement outside braces
        const endLine = i + 1;
        const slice = lines.slice(startLineIndex, endLine);
        return {
          startLine,
          endLine,
          text: slice.join("\n"),
        };
      }
    }
  }

  // Fallback when no closing brace was found
  const fallbackEndLine = Math.min(lines.length, startLineIndex + 5);
  const slice = lines.slice(startLineIndex, fallbackEndLine);
  return {
    startLine,
    endLine: fallbackEndLine,
    text: slice.join("\n"),
  };
}
