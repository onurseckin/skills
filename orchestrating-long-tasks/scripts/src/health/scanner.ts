/**
 * A lexical pass over TypeScript source. The health checks need three views of the same bytes:
 * the code with comments removed but literals intact (fallback patterns live inside literals),
 * the code with literal contents blanked too (so an identifier match cannot come from a string),
 * and the comments on their own (a commented-out block is a finding, not noise).
 *
 * Offsets are preserved: every consumed character produces exactly one output character, so a
 * character index into either view is a character index into the original file.
 */

export interface CommentRecord {
  readonly line: number;
  readonly text: string;
  readonly block: boolean;
}

export interface ScannedSource {
  /** Comments blanked, string and template contents kept. */
  readonly code: string;
  /** Comments and literal contents both blanked; only identifiers and punctuation survive. */
  readonly identifiers: string;
  readonly comments: readonly CommentRecord[];
}

/**
 * `<` is deliberately absent: in TSX, `</close>` follows one, and reading that slash as the start of
 * a regular expression swallowed the rest of the element - which is how string contents in a .tsx
 * file ended up being scanned as identifiers.
 */
const REGEX_PRECEDING = new Set("(,=:[!&|?{};+-*%^~>".split(""));
const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "yield",
  "await",
]);

function blank(char: string): string {
  return char === "\n" ? "\n" : " ";
}

/**
 * `/` opens a regular expression only where a value cannot already be complete. Reading it as
 * division everywhere would swallow the rest of the file at the first `/\//u`.
 */
function opensRegex(code: readonly string[], index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/u.test(code[cursor] ?? "")) cursor -= 1;
  if (cursor < 0) return true;
  const previous = code[cursor] ?? "";
  if (REGEX_PRECEDING.has(previous)) return true;
  if (!/[A-Za-z0-9_$]/u.test(previous)) return false;
  let start = cursor;
  while (start >= 0 && /[A-Za-z0-9_$]/u.test(code[start] ?? "")) start -= 1;
  return REGEX_KEYWORDS.has(code.slice(start + 1, cursor + 1).join(""));
}

interface Cursor {
  index: number;
  line: number;
}

class Emitter {
  readonly code: string[] = [];
  readonly identifiers: string[] = [];

  keep(char: string): void {
    this.code.push(char);
    this.identifiers.push(char);
  }

  /** Kept in `code`, blanked in `identifiers`: literal text is data, never a reference. */
  literal(char: string): void {
    this.code.push(char);
    this.identifiers.push(blank(char));
  }

  drop(char: string): void {
    this.code.push(blank(char));
    this.identifiers.push(blank(char));
  }
}

function consumeComment(
  text: string,
  cursor: Cursor,
  emit: Emitter,
  comments: CommentRecord[],
): void {
  const block = text[cursor.index + 1] === "*";
  const startLine = cursor.line;
  const start = cursor.index;
  cursor.index += 2;
  while (cursor.index < text.length) {
    const char = text[cursor.index] ?? "";
    if (!block && char === "\n") break;
    if (block && char === "*" && text[cursor.index + 1] === "/") {
      cursor.index += 2;
      break;
    }
    if (char === "\n") cursor.line += 1;
    cursor.index += 1;
  }
  const raw = text.slice(start, cursor.index);
  comments.push({ line: startLine, text: raw, block });
  for (const char of raw) emit.drop(char);
}

function consumeQuoted(text: string, cursor: Cursor, emit: Emitter, quote: string): void {
  emit.keep(quote);
  cursor.index += 1;
  while (cursor.index < text.length) {
    const char = text[cursor.index] ?? "";
    if (char === "\\") {
      emit.literal(char);
      emit.literal(text[cursor.index + 1] ?? "");
      cursor.index += 2;
      continue;
    }
    if (char === quote) {
      emit.keep(char);
      cursor.index += 1;
      return;
    }
    if (char === "\n") cursor.line += 1;
    emit.literal(char);
    cursor.index += 1;
  }
}

function consumeRegex(text: string, cursor: Cursor, emit: Emitter): void {
  emit.keep("/");
  cursor.index += 1;
  let inClass = false;
  while (cursor.index < text.length) {
    const char = text[cursor.index] ?? "";
    if (char === "\\") {
      emit.literal(char);
      emit.literal(text[cursor.index + 1] ?? "");
      cursor.index += 2;
      continue;
    }
    if (char === "\n") {
      cursor.line += 1;
      emit.literal(char);
      cursor.index += 1;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      emit.keep(char);
      cursor.index += 1;
      return;
    }
    emit.literal(char);
    cursor.index += 1;
  }
}

/** Template literals nest code inside `${}`; the interpolations are code and must stay readable. */
function consumeTemplate(text: string, cursor: Cursor, emit: Emitter, depth: number): void {
  emit.keep("`");
  cursor.index += 1;
  while (cursor.index < text.length) {
    const char = text[cursor.index] ?? "";
    if (char === "\\") {
      emit.literal(char);
      emit.literal(text[cursor.index + 1] ?? "");
      cursor.index += 2;
      continue;
    }
    if (char === "`") {
      emit.keep(char);
      cursor.index += 1;
      return;
    }
    if (char === "$" && text[cursor.index + 1] === "{") {
      emit.keep(char);
      emit.keep("{");
      cursor.index += 2;
      scanRegion(text, cursor, emit, [], depth + 1);
      continue;
    }
    if (char === "\n") cursor.line += 1;
    emit.literal(char);
    cursor.index += 1;
  }
}

/** Scans code until the file ends, or until the `}` closing an interpolation at `depth > 0`. */
function scanRegion(
  text: string,
  cursor: Cursor,
  emit: Emitter,
  comments: CommentRecord[],
  depth: number,
): void {
  let braces = 0;
  while (cursor.index < text.length) {
    const char = text[cursor.index] ?? "";
    if (char === "/" && (text[cursor.index + 1] === "/" || text[cursor.index + 1] === "*")) {
      consumeComment(text, cursor, emit, comments);
      continue;
    }
    if (char === '"' || char === "'") {
      consumeQuoted(text, cursor, emit, char);
      continue;
    }
    if (char === "`") {
      consumeTemplate(text, cursor, emit, depth);
      continue;
    }
    if (char === "/" && opensRegex(emit.code, emit.code.length)) {
      consumeRegex(text, cursor, emit);
      continue;
    }
    if (char === "{") braces += 1;
    if (char === "}") {
      if (depth > 0 && braces === 0) {
        emit.keep(char);
        cursor.index += 1;
        return;
      }
      braces -= 1;
    }
    if (char === "\n") cursor.line += 1;
    emit.keep(char);
    cursor.index += 1;
  }
}

export function scanSource(text: string): ScannedSource {
  const emit = new Emitter();
  const comments: CommentRecord[] = [];
  scanRegion(text, { index: 0, line: 1 }, emit, comments, 0);
  return { code: emit.code.join(""), identifiers: emit.identifiers.join(""), comments };
}

/** 1-based line number for a character offset into any of the three views. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}
