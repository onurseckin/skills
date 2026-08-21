const IDENT_START = /[A-Za-z_$]/u;
const IDENT_PART = /[A-Za-z0-9_$]/u;
const DIGIT = /[0-9]/u;
const NUMBER_CONTINUATION = /[0-9a-zA-Z_$]/u;

const REGEX_OK_KEYWORDS = new Set([
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

class UnsupportedSyntax extends Error {}

function isIdentStart(ch: string): boolean {
  return IDENT_START.test(ch);
}
function isIdentPart(ch: string): boolean {
  return IDENT_PART.test(ch);
}
function isDigit(ch: string): boolean {
  return DIGIT.test(ch);
}

function scanQuotedString(text: string, start: number, quote: string): number {
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

function scanLineComment(text: string, start: number): number {
  const length = text.length;
  let index = start + 2;
  while (index < length && text[index] !== "\n" && text[index] !== "\r") index += 1;
  return index;
}

function scanBlockComment(text: string, start: number): number {
  const length = text.length;
  let index = start + 2;
  while (index < length) {
    if (text[index] === "*" && text[index + 1] === "/") return index + 2;
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated block comment");
}

function scanRegexLiteral(text: string, start: number): number {
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

function scanNumberEnd(text: string, start: number): number {
  const length = text.length;
  let index = start;
  while (index < length && NUMBER_CONTINUATION.test(text[index]!)) index += 1;
  while (text[index] === "." && index + 1 < length && isDigit(text[index + 1]!)) {
    index += 1;
    while (index < length && NUMBER_CONTINUATION.test(text[index]!)) index += 1;
  }
  return index;
}

function templateExpressionRegexAllowed(lastSignificant: string): boolean {
  if (lastSignificant === "") return true;
  const last = lastSignificant[lastSignificant.length - 1]!;
  if (last === ")" || last === "]") return false;
  if (IDENT_PART.test(last)) return false;
  return true;
}

function scanTemplateExpression(text: string, start: number): number {
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

function scanTemplateLiteral(text: string, start: number): number {
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

type Pending = "none" | "space" | "newline";

function scan(text: string): string {
  const length = text.length;
  let index = 0;
  const out: string[] = [];
  let pending: Pending = "none";
  let emittedAnything = false;
  let regexAllowedNext = true;
  let lastWord = "";

  function flushPending(): void {
    if (emittedAnything) {
      if (pending === "newline") out.push("\n");
      else if (pending === "space") out.push(" ");
    }
    pending = "none";
  }

  function emitPlain(chunk: string): void {
    flushPending();
    out.push(chunk);
    emittedAnything = true;
  }

  while (index < length) {
    const ch = text[index]!;

    if (ch === "\n") {
      pending = "newline";
      index += 1;
      continue;
    }
    if (ch === "\r") {
      pending = "newline";
      index += 1;
      if (text[index] === "\n") index += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (pending !== "newline") pending = "space";
      index += 1;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const end = scanQuotedString(text, index, ch);
      emitPlain(text.slice(index, end));
      regexAllowedNext = false;
      lastWord = "";
      index = end;
      continue;
    }

    if (ch === "`") {
      const end = scanTemplateLiteral(text, index);
      emitPlain(text.slice(index, end));
      regexAllowedNext = false;
      lastWord = "";
      index = end;
      continue;
    }

    if (ch === "/" && text[index + 1] === "/") {
      const end = scanLineComment(text, index);
      emitPlain(text.slice(index, end));
      index = end;
      continue;
    }

    if (ch === "/" && text[index + 1] === "*") {
      const end = scanBlockComment(text, index);
      emitPlain(text.slice(index, end));
      index = end;
      continue;
    }

    if (ch === "/" && regexAllowedNext) {
      const end = scanRegexLiteral(text, index);
      emitPlain(text.slice(index, end));
      regexAllowedNext = false;
      lastWord = "";
      index = end;
      continue;
    }

    if (isIdentStart(ch)) {
      let end = index + 1;
      while (end < length && isIdentPart(text[end]!)) end += 1;
      const word = text.slice(index, end);
      emitPlain(word);
      lastWord = word;
      regexAllowedNext = REGEX_OK_KEYWORDS.has(word);
      index = end;
      continue;
    }

    if (isDigit(ch)) {
      const end = scanNumberEnd(text, index);
      emitPlain(text.slice(index, end));
      lastWord = "";
      regexAllowedNext = false;
      index = end;
      continue;
    }

    emitPlain(ch);
    lastWord = "";
    regexAllowedNext = ch !== ")" && ch !== "]";
    index += 1;
  }

  return out.join("");
}

export function canonicalizeEcmaScriptWhitespace(text: string): string | undefined {
  try {
    return scan(text);
  } catch (error) {
    if (error instanceof UnsupportedSyntax) return undefined;
    throw error;
  }
}
