export const IDENT_START = /[A-Za-z_$]/u;
export const IDENT_PART = /[A-Za-z0-9_$]/u;
export const DIGIT = /[0-9]/u;
export const NUMBER_CONTINUATION = /[0-9a-zA-Z_$]/u;

export const REGEX_OK_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
  "default",
  "extends",
]);

export class UnsupportedSyntax extends Error {}

export function isIdentStart(ch: string): boolean {
  return IDENT_START.test(ch);
}
export function isIdentPart(ch: string): boolean {
  return IDENT_PART.test(ch);
}
export function isDigit(ch: string): boolean {
  return DIGIT.test(ch);
}

export function scanQuotedString(text: string, start: number, quote: string): number {
  const length = text.length;
  let index = start + 1;
  while (index < length) {
    const ch = text[index]!;
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) return index + 1;
    if (ch === "\n" || ch === "\r") throw new UnsupportedSyntax("string spans a line break");
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated string literal");
}

export function scanLineComment(text: string, start: number): number {
  const length = text.length;
  let index = start + 2;
  while (index < length && text[index] !== "\n" && text[index] !== "\r") index += 1;
  return index;
}

export function scanBlockComment(text: string, start: number): number {
  const length = text.length;
  let index = start + 2;
  while (index < length) {
    if (text[index] === "*" && text[index + 1] === "/") return index + 2;
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated block comment");
}

export function scanRegexLiteral(text: string, start: number): number {
  const length = text.length;
  let index = start + 1;
  let inClass = false;
  while (index < length) {
    const ch = text[index]!;
    if (ch === "\n" || ch === "\r") throw new UnsupportedSyntax("regex literal spans a line break");
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      index += 1;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      index += 1;
      continue;
    }
    if (ch === "/" && !inClass) {
      index += 1;
      while (index < length && /[A-Za-z]/u.test(text[index]!)) index += 1;
      return index;
    }
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated regex literal");
}

export function scanNumberEnd(text: string, start: number): number {
  const length = text.length;
  let index = start;
  while (index < length && NUMBER_CONTINUATION.test(text[index]!)) index += 1;
  while (text[index] === "." && index + 1 < length && isDigit(text[index + 1]!)) {
    index += 1;
    while (index < length && NUMBER_CONTINUATION.test(text[index]!)) index += 1;
  }
  return index;
}

export const scanNumberLiteral = scanNumberEnd;

export function templateExpressionRegexAllowed(lastSignificant: string): boolean {
  if (lastSignificant === "") return true;
  const last = lastSignificant[lastSignificant.length - 1]!;
  if (last === ")" || last === "]") return false;
  if (isIdentPart(last)) return false;
  return true;
}

export function scanTemplateExpression(text: string, start: number): number {
  const length = text.length;
  let index = start;
  let depth = 0;
  let lastSignificant = "";
  while (index < length) {
    const ch = text[index]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      lastSignificant = ch;
      index += 1;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) return index + 1;
      depth -= 1;
      lastSignificant = ch;
      index += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      index = scanQuotedString(text, index, ch);
      lastSignificant = "x";
      continue;
    }
    if (ch === "`") {
      index = scanTemplateLiteral(text, index);
      lastSignificant = "x";
      continue;
    }
    if (ch === "/" && text[index + 1] === "/") {
      index = scanLineComment(text, index);
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      index = scanBlockComment(text, index);
      continue;
    }
    if (ch === "/" && templateExpressionRegexAllowed(lastSignificant)) {
      index = scanRegexLiteral(text, index);
      lastSignificant = "x";
      continue;
    }
    lastSignificant += ch;
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated template expression");
}

export function scanTemplateLiteral(text: string, start: number): number {
  const length = text.length;
  let index = start + 1;
  while (index < length) {
    const ch = text[index]!;
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === "`") return index + 1;
    if (ch === "$" && text[index + 1] === "{") {
      index = scanTemplateExpression(text, index + 2);
      continue;
    }
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated template literal");
}
