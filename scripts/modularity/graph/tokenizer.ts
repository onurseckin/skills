import type { IndexedBlob } from "../inventory/index.ts";

export interface ImportReference {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly kind: "import" | "export";
}

interface ScanResult {
  readonly references: readonly ImportReference[];
  readonly exportStars: number;
}

function isIdentifier(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function isWordAt(source: string, offset: number, word: string): boolean {
  return (
    source.slice(offset, offset + word.length) === word &&
    !isIdentifier(source[offset - 1]) &&
    !isIdentifier(source[offset + word.length])
  );
}

function skipQuoted(source: string, offset: number, quote: string): number {
  let index = offset + 1;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index++] === quote) return index;
  }
  return source.length;
}

function skipComment(source: string, offset: number): number {
  if (source[offset + 1] === "/") {
    const newline = source.indexOf("\n", offset + 2);
    return newline < 0 ? source.length : newline + 1;
  }
  const end = source.indexOf("*/", offset + 2);
  return end < 0 ? source.length : end + 2;
}

function skipRegex(source: string, offset: number): number {
  let index = offset + 1;
  let characterClass = false;
  while (index < source.length) {
    if (source[index] === "\\") index += 2;
    else if (source[index] === "[") {
      characterClass = true;
      index += 1;
    } else if (source[index] === "]") {
      characterClass = false;
      index += 1;
    } else if (source[index] === "/" && !characterClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] ?? "")) index += 1;
      return index;
    } else index += 1;
  }
  return source.length;
}

function skipTrivia(source: string, offset: number): number {
  let index = offset;
  while (index < source.length) {
    if (/\s/.test(source[index])) index += 1;
    else if (source[index] === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipComment(source, index);
    } else break;
  }
  return index;
}

function malformedSpecifier(detail: string): never {
  throw new Error(`Malformed module specifier: ${detail}`);
}

function decodeEscape(
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
  if (escaped === "x" || escaped === "u") {
    const braced = escaped === "u" && source[offset + 1] === "{";
    const start = offset + (braced ? 2 : 1);
    const close = braced ? source.indexOf("}", start) : start + (escaped === "x" ? 2 : 4);
    const digits = source.slice(start, close);
    if (!/^[0-9a-f]+$/i.test(digits) || (!braced && digits.length !== close - start)) {
      malformedSpecifier("invalid hexadecimal escape");
    }
    const value = Number.parseInt(digits, 16);
    if (value > 0x10ffff || (braced && source[close] !== "}")) {
      malformedSpecifier("invalid Unicode code point");
    }
    return { value: String.fromCodePoint(value), end: braced ? close + 1 : close };
  }
  if (escaped === "0" && /[0-9]/.test(source[offset + 1] ?? "")) {
    malformedSpecifier("legacy octal escape");
  }
  if (escaped === "\n") return { value: "", end: offset + 1 };
  if (escaped === "\r")
    return { value: "", end: source[offset + 1] === "\n" ? offset + 2 : offset + 1 };
  return { value: simple[escaped] ?? (escaped === "0" ? "\0" : escaped), end: offset + 1 };
}

function readString(
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
      if (character === "\n" || character === "\r") malformedSpecifier("unterminated string");
      value += character;
      index += 1;
    }
  }
  return malformedSpecifier("unterminated string");
}

function readReference(
  source: string,
  offset: number,
  kind: ImportReference["kind"],
): ImportReference | null {
  let index = skipTrivia(source, offset);
  if (kind === "import" && source[index] === "(") return null;
  const direct = readString(source, index);
  if (direct) return { specifier: direct.value, typeOnly: false, kind };

  const typeOnly = isWordAt(source, index, "type");
  if (typeOnly) index = skipTrivia(source, index + 4);
  let depth = 0;
  while (index < source.length && source[index] !== ";") {
    index = skipTrivia(source, index);
    if (source[index] === ";") return null;
    if (depth === 0 && isWordAt(source, index, "from")) {
      const specifier = readString(source, skipTrivia(source, index + 4));
      return specifier ? { specifier: specifier.value, typeOnly, kind } : null;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === "`") {
      index = skipQuoted(source, index, source[index]);
    } else if ("({[".includes(source[index])) {
      depth += 1;
      index += 1;
    } else if (")}]".includes(source[index])) {
      depth = Math.max(0, depth - 1);
      index += 1;
    } else if (depth === 0 && isWordAt(source, index, "import")) return null;
    else index += 1;
  }
  return null;
}

function canStartRegex(previous: string): boolean {
  return (
    previous === "" ||
    "=([{,:;!?&|".includes(previous) ||
    previous === "return" ||
    previous === "throw"
  );
}

function scan(source: string): ScanResult {
  const references: ImportReference[] = [];
  let exportStars = 0;
  let index = 0;
  let previous = "";
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "/" && (source[index + 1] === "/" || source[index + 1] === "*")) {
      index = skipComment(source, index);
    } else if (character === "'" || character === '"' || character === "`") {
      index = skipQuoted(source, index, character);
    } else if (character === "/" && canStartRegex(previous)) {
      index = skipRegex(source, index);
    } else if (isIdentifier(character)) {
      let end = index + 1;
      while (isIdentifier(source[end])) end += 1;
      const word = source.slice(index, end);
      if (word === "import") {
        const reference = readReference(source, end, "import");
        if (reference) references.push(reference);
      } else if (word === "export") {
        const next = skipTrivia(source, end);
        const star = isWordAt(source, next, "type") ? skipTrivia(source, next + 4) : next;
        if (source[star] === "*") exportStars += 1;
        const reference = readReference(source, end, "export");
        if (reference) references.push(reference);
      }
      previous = word;
      index = end;
    } else {
      previous = character;
      index += 1;
    }
  }
  return { references, exportStars };
}

export function scanImports(blob: IndexedBlob): readonly ImportReference[] {
  return scan(new TextDecoder("utf-8", { fatal: true }).decode(blob.bytes)).references;
}

export function countExportStars(blob: IndexedBlob): number {
  return scan(new TextDecoder("utf-8", { fatal: true }).decode(blob.bytes)).exportStars;
}
