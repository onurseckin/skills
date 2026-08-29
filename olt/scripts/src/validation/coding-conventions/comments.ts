import { extname } from "node:path";

export interface CommentViolation {
  readonly line: number;
  readonly column: number;
  readonly type: "single-line" | "multi-line" | "docblock";
  readonly snippet: string;
}

export interface ZeroCommentsValidationResult {
  readonly valid: boolean;
  readonly filePath?: string | undefined;
  readonly violations: readonly CommentViolation[];
}

const EXEMPT_EXTS = new Set([
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".txt",
  ".csv",
]);

export function validateZeroCommentsInCode(
  code: string,
  filePath?: string,
): ZeroCommentsValidationResult {
  if (filePath && EXEMPT_EXTS.has(extname(filePath).toLowerCase())) {
    return { valid: true, filePath, violations: [] };
  }
  const violations: CommentViolation[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  const len = code.length;
  let state: "NORMAL" | "SINGLE" | "DOUBLE" | "TEMPLATE" | "REGEX" = "NORMAL";
  const templateStack: number[] = [];

  while (i < len) {
    const ch = code[i] ?? "";
    const next = i + 1 < len ? (code[i + 1] ?? "") : "";
    if (ch === "\n") {
      line++;
      col = 1;
      i++;
      continue;
    }
    if (state === "SINGLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "'") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "DOUBLE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === '"') state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "TEMPLATE") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "$" && next === "{") {
        templateStack.push(0);
        state = "NORMAL";
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "`") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (state === "REGEX") {
      if (ch === "\\") {
        i += 2;
        col += 2;
        continue;
      }
      if (ch === "/") state = "NORMAL";
      i++;
      col++;
      continue;
    }
    if (templateStack.length > 0) {
      const topIdx = templateStack.length - 1;
      const top = templateStack[topIdx];
      if (top !== undefined) {
        if (ch === "{") templateStack[topIdx] = top + 1;
        else if (ch === "}") {
          if (top === 0) {
            templateStack.pop();
            state = "TEMPLATE";
            i++;
            col++;
            continue;
          }
          templateStack[topIdx] = top - 1;
        }
      }
    }
    if (ch === "'") {
      state = "SINGLE";
      i++;
      col++;
      continue;
    }
    if (ch === '"') {
      state = "DOUBLE";
      i++;
      col++;
      continue;
    }
    if (ch === "`") {
      state = "TEMPLATE";
      i++;
      col++;
      continue;
    }
    if (ch === "/" && next === "/") {
      let end = code.indexOf("\n", i);
      if (end === -1) end = len;
      violations.push({
        line,
        column: col,
        type: "single-line",
        snippet: code.slice(i, end).trim(),
      });
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const isDoc = code.slice(i, i + 3) === "/**";
      const end = code.indexOf("*/", i + 2);
      const closeIdx = end === -1 ? len : end + 2;
      violations.push({
        line,
        column: col,
        type: isDoc ? "docblock" : "multi-line",
        snippet: code.slice(i, Math.min(i + 60, closeIdx)).trim(),
      });
      const commentLines = code.slice(i, closeIdx).split("\n");
      const lastLine = commentLines[commentLines.length - 1];
      const firstLine = commentLines[0];
      if (commentLines.length > 1 && lastLine !== undefined) {
        line += commentLines.length - 1;
        col = lastLine.length + 1;
      } else if (firstLine !== undefined) {
        col += firstLine.length;
      }
      i = closeIdx;
      continue;
    }
    if (ch === "/") {
      let p = i - 1;
      while (p >= 0 && /\s/.test(code[p] ?? "")) p--;
      const pc = p >= 0 ? (code[p] ?? "") : "";
      const isKw = /(?:return|case|typeof|void|delete|throw|yield|await|in|of|instanceof)\s*$/.test(
        code.slice(Math.max(0, p - 10), p + 1),
      );
      if (pc === "" || /[\(\[\{,;:\?=\!&|\+\-\*%<>~^]/.test(pc) || isKw) state = "REGEX";
    }
    i++;
    col++;
  }
  return {
    valid: violations.length === 0,
    ...(filePath !== undefined ? { filePath } : {}),
    violations,
  };
}
