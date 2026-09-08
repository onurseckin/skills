import ts from "typescript";
import type { CommentKind, CommentSpan, FileCommentMetrics } from "./contracts.ts";

const EXPR_PRECEDING_TOKENS: ReadonlySet<number> = new Set<number>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

export interface ScannedCommentsResult {
  readonly comments: readonly CommentSpan[];
  readonly commentLines: number;
  readonly totalComments: number;
}

function buildLineStarts(text: string): readonly number[] {
  const starts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function resolveCoordinates(
  pos: number,
  lineStarts: readonly number[],
): { readonly line: number; readonly column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const startPos = lineStarts[mid];
    if (startPos !== undefined && startPos <= pos) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIndex = high >= 0 ? high : 0;
  const lineStart = lineStarts[lineIndex] ?? 0;
  return {
    line: lineIndex + 1,
    column: pos - lineStart + 1,
  };
}

export function scanCommentsInSource(
  code: string,
  fileName: string = "source.ts",
): ScannedCommentsResult {
  if (!code.includes("//") && !code.includes("/*")) {
    return { comments: [], commentLines: 0, totalComments: 0 };
  }

  const isJsx = fileName.endsWith(".tsx") || fileName.endsWith(".jsx");
  const languageVariant = isJsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, code);

  const comments: CommentSpan[] = [];
  const lineStarts = buildLineStarts(code);
  const commentLineNumbers = new Set<number>();
  const templateStack: number[] = [];
  let braceDepth = 0;
  let lastSignificantToken = ts.SyntaxKind.Unknown;

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      const startPos = scanner.getTokenPos();
      const endPos = scanner.getTextPos();
      const text = scanner.getTokenText();
      const kind: CommentKind = token === ts.SyntaxKind.SingleLineCommentTrivia ? "line" : "block";

      const startCoords = resolveCoordinates(startPos, lineStarts);
      const endPosAdjusted = endPos > startPos ? endPos - 1 : startPos;
      const endCoords = resolveCoordinates(endPosAdjusted, lineStarts);

      for (let line = startCoords.line; line <= endCoords.line; line += 1) {
        commentLineNumbers.add(line);
      }

      comments.push({
        startLine: startCoords.line,
        startColumn: startCoords.column,
        endLine: endCoords.line,
        endColumn: endCoords.column,
        kind,
        text,
      });
    } else {
      if (token === ts.SyntaxKind.TemplateHead) {
        braceDepth += 1;
        templateStack.push(braceDepth);
      } else if (token === ts.SyntaxKind.OpenBraceToken) {
        braceDepth += 1;
      } else if (token === ts.SyntaxKind.CloseBraceToken) {
        if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
          templateStack.pop();
          braceDepth -= 1;
          token = scanner.reScanTemplateToken(false);
          if (token === ts.SyntaxKind.TemplateMiddle) {
            braceDepth += 1;
            templateStack.push(braceDepth);
          }
          lastSignificantToken = token;
          token = scanner.scan();
          continue;
        }
        braceDepth -= 1;
      } else if (token === ts.SyntaxKind.SlashToken || token === ts.SyntaxKind.SlashEqualsToken) {
        if (
          EXPR_PRECEDING_TOKENS.has(lastSignificantToken) ||
          lastSignificantToken === ts.SyntaxKind.Unknown
        ) {
          const reToken = scanner.reScanSlashToken();
          if (reToken === ts.SyntaxKind.RegularExpressionLiteral) {
            token = reToken;
          }
        }
      }

      if (token !== ts.SyntaxKind.WhitespaceTrivia && token !== ts.SyntaxKind.NewLineTrivia) {
        lastSignificantToken = token;
      }
    }
    token = scanner.scan();
  }

  return {
    comments,
    commentLines: commentLineNumbers.size,
    totalComments: comments.length,
  };
}

export function scanFileComments(filePath: string, content: string): FileCommentMetrics {
  const result = scanCommentsInSource(content, filePath);
  return {
    file: filePath,
    commentLines: result.commentLines,
    totalComments: result.totalComments,
    comments: result.comments,
  };
}
