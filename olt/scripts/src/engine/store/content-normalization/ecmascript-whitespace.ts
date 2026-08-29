import {
  REGEX_OK_KEYWORDS,
  UnsupportedSyntax,
  isIdentStart,
  isIdentPart,
  isDigit,
  scanQuotedString,
  scanLineComment,
  scanBlockComment,
  scanRegexLiteral,
  scanNumberEnd,
  scanTemplateLiteral,
} from "./ecmascript-scanner.ts";

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
