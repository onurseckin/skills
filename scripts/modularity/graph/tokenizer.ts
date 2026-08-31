import type { IndexedBlob } from "../inventory/index.ts";
import {
  isIdentifier,
  isQuoteChar,
  isWordAt,
  readString,
  skipComment,
  skipQuoted,
  skipRegex,
  skipTrivia,
} from "./tokenizer-escape.ts";

export interface ImportReference {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly kind: "import" | "export";
}

interface ScanResult {
  readonly references: readonly ImportReference[];
  readonly exportStars: number;
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
    const char = source[index];
    if (isQuoteChar(char) && char !== undefined) {
      index = skipQuoted(source, index, char);
    } else if (char !== undefined && "({[".includes(char)) {
      depth += 1;
      index += 1;
    } else if (char !== undefined && ")}]".includes(char)) {
      depth = Math.max(0, depth - 1);
      index += 1;
    } else if (depth === 0 && isWordAt(source, index, "import")) {
      return null;
    } else {
      index += 1;
    }
  }
  return null;
}

function canStartRegex(previous: string): boolean {
  if (previous === "") return true;
  if ("=([{,:;!?&|".includes(previous)) return true;
  if (previous === "return") return true;
  if (previous === "throw") return true;
  return false;
}

function scan(source: string): ScanResult {
  const references: ImportReference[] = [];
  let exportStars = 0;
  const hashbangEnd = source.indexOf("\n");
  let index = 0;
  if (source.startsWith("#!")) {
    index = hashbangEnd < 0 ? source.length : hashbangEnd + 1;
  }
  let previous = "";
  while (index < source.length) {
    const character = source[index];
    if (character === undefined) break;
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "/") {
      const nextChar = source[index + 1];
      const isComment = nextChar === "/" ? true : nextChar === "*";
      if (isComment) {
        index = skipComment(source, index);
      } else if (canStartRegex(previous)) {
        index = skipRegex(source, index);
      } else {
        previous = character;
        index += 1;
      }
    } else if (isQuoteChar(character)) {
      index = skipQuoted(source, index, character);
    } else if (isIdentifier(character)) {
      let end = index + 1;
      while (end < source.length && isIdentifier(source[end])) {
        end += 1;
      }
      const word = source.slice(index, end);
      if (word === "import") {
        const reference = readReference(source, end, "import");
        if (reference) references.push(reference);
      } else if (word === "export") {
        const next = skipTrivia(source, end);
        const star = isWordAt(source, next, "type") ? skipTrivia(source, next + 4) : next;
        if (star < source.length && source[star] === "*") exportStars += 1;
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
