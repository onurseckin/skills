import type { IndexedBlob } from "../inventory/index.ts";
import {
  canStartRegex,
  isIdentifier,
  isQuoteChar,
  isWordAt,
  readString,
  skipComment,
  skipQuoted,
  skipRegex,
  skipTemplateLiteral,
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
  if (kind === "import") {
    if (source[index] === ".") return null;
    if (source[index] === "(") {
      const dynamic = readString(source, skipTrivia(source, index + 1));
      return dynamic ? { specifier: dynamic.value, typeOnly: false, kind } : null;
    }
  }
  const direct = readString(source, index);
  if (direct) return { specifier: direct.value, typeOnly: false, kind };

  const typeOnly = isWordAt(source, index, "type");
  if (typeOnly) index = skipTrivia(source, index + 4);
  let depth = 0;
  let hadBraces = false;
  while (index < source.length && source[index] !== ";") {
    index = skipTrivia(source, index);
    if (source[index] === ";") return null;
    if (depth === 0) {
      if (isWordAt(source, index, "from")) {
        const prevChar = source[index - 1];
        if (prevChar === ".") return null;
        const specifier = readString(source, skipTrivia(source, index + 4));
        return specifier ? { specifier: specifier.value, typeOnly, kind } : null;
      }
      if (hadBraces) return null;
    }
    const char = source[index];
    if (char === undefined) return null;
    if (isQuoteChar(char)) {
      index = char === "`" ? skipTemplateLiteral(source, index) : skipQuoted(source, index, char);
    } else if ("({[".includes(char)) {
      if (char === "{") hadBraces = true;
      depth += 1;
      index += 1;
    } else if (")}]".includes(char)) {
      depth = Math.max(0, depth - 1);
      index += 1;
    } else if (
      depth === 0 &&
      (isWordAt(source, index, "import") ||
        isWordAt(source, index, "export") ||
        isWordAt(source, index, "const") ||
        isWordAt(source, index, "let") ||
        isWordAt(source, index, "var") ||
        isWordAt(source, index, "function") ||
        isWordAt(source, index, "class"))
    ) {
      return null;
    } else {
      index += 1;
    }
  }
  return null;
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
      index =
        character === "`"
          ? skipTemplateLiteral(source, index)
          : skipQuoted(source, index, character);
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
        const isType = isWordAt(source, next, "type");
        const afterType = isType ? skipTrivia(source, next + 4) : next;
        const char = source[afterType];
        if (char === "*" || char === "{") {
          if (char === "*") {
            const afterStar = skipTrivia(source, afterType + 1);
            const isNamespace = isWordAt(source, afterStar, "as");
            if (!isNamespace) exportStars += 1;
          }
          const reference = readReference(source, end, "export");
          if (reference) references.push(reference);
        }
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
