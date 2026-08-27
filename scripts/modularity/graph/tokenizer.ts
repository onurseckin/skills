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

function skipSpace(source: string, offset: number): number {
  let index = offset;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}

function readString(
  source: string,
  offset: number,
): { readonly value: string; readonly end: number } | null {
  const quote = source[offset];
  if (quote !== "'" && quote !== '"') return null;
  const end = skipQuoted(source, offset, quote);
  if (end === source.length && source[end - 1] !== quote) return null;
  return { value: source.slice(offset + 1, end - 1), end };
}

function readReference(
  source: string,
  offset: number,
  kind: ImportReference["kind"],
): ImportReference | null {
  let index = skipSpace(source, offset);
  if (kind === "import" && source[index] === "(") return null;
  const direct = readString(source, index);
  if (direct) return { specifier: direct.value, typeOnly: false, kind };

  const typeOnly = isWordAt(source, index, "type");
  if (typeOnly) index = skipSpace(source, index + 4);
  while (index < source.length && source[index] !== ";" && source[index] !== "\n") {
    if (isWordAt(source, index, "from")) {
      const specifier = readString(source, skipSpace(source, index + 4));
      return specifier ? { specifier: specifier.value, typeOnly, kind } : null;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === "`") {
      index = skipQuoted(source, index, source[index]);
    } else index += 1;
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
        const next = skipSpace(source, end);
        if (source[next] === "*") exportStars += 1;
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
