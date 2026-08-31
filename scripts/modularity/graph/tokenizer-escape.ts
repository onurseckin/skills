export function isIdentifier(character: string | undefined): boolean {
  if (character === undefined) return false;
  return /[A-Za-z0-9_$]/.test(character);
}

export function isWordAt(source: string, offset: number, word: string): boolean {
  if (source.slice(offset, offset + word.length) !== word) return false;
  const before = source[offset - 1];
  if (isIdentifier(before)) return false;
  const after = source[offset + word.length];
  if (isIdentifier(after)) return false;
  return true;
}

export function isQuoteChar(char: string | undefined): boolean {
  if (char === "'") return true;
  if (char === '"') return true;
  if (char === "`") return true;
  return false;
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "",
  "return",
  "throw",
  "case",
  "delete",
  "void",
  "typeof",
  "instanceof",
  "in",
  "of",
  "yield",
  "await",
  "default",
  "do",
  "else",
]);

export function canStartRegex(previous: string): boolean {
  if (REGEX_PREFIX_KEYWORDS.has(previous)) return true;
  if (previous.length === 1 && "=([{,:;!?&|~^+-*%<>".includes(previous)) return true;
  if (
    ["&&", "||", "??", "==", "!=", "<=", ">=", "=>", "+=", "-=", "*=", "/=", "%="].includes(
      previous,
    )
  ) {
    return true;
  }
  return false;
}

export function skipQuoted(source: string, offset: number, quote: string): number {
  let index = offset + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
    } else {
      const char = source[index];
      index += 1;
      if (char === quote) return index;
    }
  }
  return source.length;
}

export function skipTemplateLiteral(source: string, offset: number): number {
  let index = offset + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
    } else if (char === "`") {
      return index + 1;
    } else if (char === "$" && source[index + 1] === "{") {
      index += 2;
      let depth = 1;
      let exprPrev = "";
      while (index < source.length && depth > 0) {
        const c = source[index];
        if (c === undefined) break;
        if (/\s/.test(c)) {
          index += 1;
        } else if (c === "/") {
          const nextChar = source[index + 1];
          if (nextChar === "/" || nextChar === "*") {
            index = skipComment(source, index);
          } else if (canStartRegex(exprPrev)) {
            index = skipRegex(source, index);
          } else {
            exprPrev = c;
            index += 1;
          }
        } else if (c === "'" || c === '"') {
          index = skipQuoted(source, index, c);
          exprPrev = c;
        } else if (c === "`") {
          index = skipTemplateLiteral(source, index);
          exprPrev = c;
        } else if (c === "{") {
          depth += 1;
          exprPrev = c;
          index += 1;
        } else if (c === "}") {
          depth -= 1;
          exprPrev = c;
          index += 1;
          if (depth === 0) break;
        } else if (isIdentifier(c)) {
          let end = index + 1;
          while (end < source.length && isIdentifier(source[end])) {
            end += 1;
          }
          exprPrev = source.slice(index, end);
          index = end;
        } else {
          exprPrev = c;
          index += 1;
        }
      }
    } else {
      index += 1;
    }
  }
  return source.length;
}

export function skipComment(source: string, offset: number): number {
  if (source[offset + 1] === "/") {
    const newline = source.indexOf("\n", offset + 2);
    if (newline < 0) return source.length;
    return newline + 1;
  }
  const end = source.indexOf("*/", offset + 2);
  if (end < 0) return source.length;
  return end + 2;
}

export function skipRegex(source: string, offset: number): number {
  let index = offset + 1;
  let characterClass = false;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
    } else if (source[index] === "[") {
      characterClass = true;
      index += 1;
    } else if (source[index] === "]") {
      characterClass = false;
      index += 1;
    } else if (source[index] === "/" && !characterClass) {
      index += 1;
      while (index < source.length) {
        const flag = source[index];
        if (flag !== undefined && /[A-Za-z]/.test(flag)) {
          index += 1;
        } else {
          break;
        }
      }
      return index;
    } else {
      index += 1;
    }
  }
  return source.length;
}

export function skipTrivia(source: string, offset: number): number {
  let index = offset;
  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;
    if (/\s/.test(char)) {
      index += 1;
    } else {
      const nextChar = source[index + 1];
      const isComment = nextChar === "/" ? true : nextChar === "*";
      if (char === "/" && isComment) {
        index = skipComment(source, index);
      } else {
        break;
      }
    }
  }
  return index;
}

export function malformedSpecifier(detail: string): never {
  throw new Error(`Malformed module specifier: ${detail}`);
}

export function decodeEscape(
  source: string,
  offset: number,
): { readonly value: string; readonly end: number } {
  const escaped = source[offset];
  const simple: Record<string, string> = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  if (escaped === undefined) malformedSpecifier("unfinished escape");
  if (escaped === "x") {
    const start = offset + 1;
    const close = start + 2;
    const digits = source.slice(start, close);
    if (!/^[0-9a-f]+$/i.test(digits)) {
      malformedSpecifier("invalid hexadecimal escape");
    }
    if (digits.length !== close - start) {
      malformedSpecifier("invalid hexadecimal escape");
    }
    const value = Number.parseInt(digits, 16);
    return {
      value: String.fromCodePoint(value),
      end: close,
    };
  }
  if (escaped === "u") {
    const braced = source[offset + 1] === "{";
    const start = offset + (braced ? 2 : 1);
    const close = braced ? source.indexOf("}", start) : start + 4;
    const digits = source.slice(start, close);
    if (!/^[0-9a-f]+$/i.test(digits)) {
      malformedSpecifier("invalid hexadecimal escape");
    }
    if (!braced && digits.length !== close - start) {
      malformedSpecifier("invalid hexadecimal escape");
    }
    const value = Number.parseInt(digits, 16);
    if (value > 0x10ffff) {
      malformedSpecifier("invalid Unicode code point");
    }
    if (braced && source[close] !== "}") {
      malformedSpecifier("invalid Unicode code point");
    }
    return {
      value: String.fromCodePoint(value),
      end: braced ? close + 1 : close,
    };
  }
  if (escaped === "0") {
    const nextChar = source[offset + 1];
    if (nextChar !== undefined && /[0-9]/.test(nextChar)) malformedSpecifier("legacy octal escape");
  }
  if (escaped === "\n") return { value: "", end: offset + 1 };
  if (escaped === "\r") {
    return { value: "", end: source[offset + 1] === "\n" ? offset + 2 : offset + 1 };
  }
  const simpleVal = simple[escaped];
  if (simpleVal !== undefined) return { value: simpleVal, end: offset + 1 };
  return { value: escaped === "0" ? "\0" : escaped, end: offset + 1 };
}

export function readString(
  source: string,
  offset: number,
): { readonly value: string; readonly end: number } | null {
  const quote = source[offset];
  if (quote !== "'" && quote !== '"') return null;
  let index = offset + 1;
  let value = "";
  while (index < source.length) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character === "\\") {
      const decoded = decodeEscape(source, index + 1);
      value += decoded.value;
      index = decoded.end;
    } else {
      if (character === "\n") malformedSpecifier("unterminated string");
      if (character === "\r") malformedSpecifier("unterminated string");
      if (character !== undefined) {
        value += character;
      }
      index += 1;
    }
  }
  return malformedSpecifier("unterminated string");
}
