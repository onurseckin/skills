import type { JsonValue } from "../../../core/contracts/index.ts";

export class UnsupportedSyntax extends Error {}

export interface Line {
  indent: number;
  content: string;
}

export interface ParseResult {
  value: JsonValue;
  next: number;
}

export interface FlowResult {
  value: JsonValue;
  end: number;
}

export function stripComment(content: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index]!;
    if (inSingle) {
      if (ch === "'") {
        if (content[index + 1] === "'") {
          index += 1;
          continue;
        }
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "#" && (index === 0 || content[index - 1] === " " || content[index - 1] === "\t")) {
      return content.slice(0, index);
    }
  }
  if (inSingle || inDouble) throw new UnsupportedSyntax("unterminated quoted scalar");
  return content;
}

export function splitLines(text: string): Line[] {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const rawLines = normalized.length === 0 ? [] : normalized.split("\n");
  const lines: Line[] = [];
  for (const rawLine of rawLines) {
    if (/^[ \t]*$/u.test(rawLine)) continue;
    const leading = /^[ \t]*/u.exec(rawLine)![0];
    if (leading.includes("\t"))
      throw new UnsupportedSyntax("tabs are not supported in indentation");
    const indent = leading.length;
    const withoutComment = stripComment(rawLine.slice(indent)).trimEnd();
    if (withoutComment.length === 0) continue;
    if (
      withoutComment === "---" ||
      withoutComment.startsWith("--- ") ||
      withoutComment === "..." ||
      withoutComment.startsWith("%") ||
      withoutComment === "?" ||
      withoutComment.startsWith("? ")
    )
      throw new UnsupportedSyntax(`unsupported YAML construct: ${withoutComment}`);
    lines.push({ indent, content: withoutComment });
  }
  return lines;
}

export function isSequenceItem(content: string): boolean {
  return content === "-" || content.startsWith("- ");
}

export function findKeyColon(content: string): number | undefined {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index]!;
    if (inSingle) {
      if (ch === "'") {
        if (content[index + 1] === "'") {
          index += 1;
          continue;
        }
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        index += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "]" || ch === "}") {
      depth -= 1;
      continue;
    }
    if (ch === ":" && depth === 0) {
      const next = content[index + 1];
      if (next === undefined || next === " " || next === "\t") return index;
    }
  }
  return undefined;
}

export function isMappingKeyLine(content: string): boolean {
  return findKeyColon(content) !== undefined;
}

export function parsePlainScalar(raw: string): JsonValue {
  if (raw === "~" || raw === "null" || raw === "Null" || raw === "NULL") return null;
  if (raw === "true" || raw === "True" || raw === "TRUE") return true;
  if (raw === "false" || raw === "False" || raw === "FALSE") return false;
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/u.test(raw)) {
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return raw;
}

export function findDoubleQuotedEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === '"') return index + 1;
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated double-quoted scalar");
}

export function findSingleQuotedEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === "'") {
      if (text[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  throw new UnsupportedSyntax("unterminated single-quoted scalar");
}

export function parseDoubleQuoted(raw: string): string {
  if (raw.length < 2 || raw[raw.length - 1] !== '"')
    throw new UnsupportedSyntax("malformed double-quoted scalar");
  let result = "";
  let index = 1;
  while (index < raw.length - 1) {
    const ch = raw[index]!;
    if (ch === "\\") {
      const next = raw[index + 1];
      if (next === undefined)
        throw new UnsupportedSyntax("dangling escape in double-quoted scalar");
      result +=
        next === "n"
          ? "\n"
          : next === "t"
            ? "\t"
            : next === "r"
              ? "\r"
              : next === "0"
                ? "\0"
                : next;
      index += 2;
      continue;
    }
    if (ch === '"') throw new UnsupportedSyntax("unexpected quote inside double-quoted scalar");
    result += ch;
    index += 1;
  }
  return result;
}

export function parseSingleQuoted(raw: string): string {
  if (raw.length < 2 || raw[raw.length - 1] !== "'")
    throw new UnsupportedSyntax("malformed single-quoted scalar");
  let result = "";
  let index = 1;
  while (index < raw.length - 1) {
    const ch = raw[index]!;
    if (ch === "'") {
      if (raw[index + 1] === "'") {
        result += "'";
        index += 2;
        continue;
      }
      throw new UnsupportedSyntax("unexpected quote inside single-quoted scalar");
    }
    result += ch;
    index += 1;
  }
  return result;
}

export function skipFlowSpace(text: string, start: number): number {
  let index = start;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
  return index;
}

export function findPlainFlowScalarEnd(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === "," || ch === "]" || ch === "}" || ch === ":") break;
    index += 1;
  }
  return index;
}

export function parseFlowValue(text: string, start: number): FlowResult {
  const position = skipFlowSpace(text, start);
  if (position >= text.length) throw new UnsupportedSyntax("expected flow value");
  const first = text[position]!;
  if (first === "[") return parseFlowSequenceAt(text, position);
  if (first === "{") return parseFlowMappingAt(text, position);
  if (first === '"') {
    const end = findDoubleQuotedEnd(text, position);
    return { value: parseDoubleQuoted(text.slice(position, end)), end };
  }
  if (first === "'") {
    const end = findSingleQuotedEnd(text, position);
    return { value: parseSingleQuoted(text.slice(position, end)), end };
  }
  const end = findPlainFlowScalarEnd(text, position);
  const raw = text.slice(position, end).trim();
  return { value: raw.length === 0 ? null : parsePlainScalar(raw), end };
}

export function parseFlowSequenceAt(text: string, start: number): FlowResult {
  const items: JsonValue[] = [];
  let index = skipFlowSpace(text, start + 1);
  if (text[index] === "]") return { value: items, end: index + 1 };
  for (;;) {
    const parsed = parseFlowValue(text, index);
    items.push(parsed.value);
    index = skipFlowSpace(text, parsed.end);
    const ch = text[index];
    if (ch === ",") {
      index = skipFlowSpace(text, index + 1);
      continue;
    }
    if (ch === "]") return { value: items, end: index + 1 };
    throw new UnsupportedSyntax("malformed flow sequence");
  }
}

export function parseFlowMappingKey(text: string, index: number): { key: string; end: number } {
  if (text[index] === '"') {
    const end = findDoubleQuotedEnd(text, index);
    return { key: parseDoubleQuoted(text.slice(index, end)), end };
  }
  if (text[index] === "'") {
    const end = findSingleQuotedEnd(text, index);
    return { key: parseSingleQuoted(text.slice(index, end)), end };
  }
  let position = index;
  while (position < text.length && text[position] !== ":" && text[position] !== ",") position += 1;
  const key = text.slice(index, position).trim();
  if (key.length === 0) throw new UnsupportedSyntax("empty flow mapping key");
  return { key, end: position };
}

export function parseFlowMappingAt(text: string, start: number): FlowResult {
  const result: Record<string, JsonValue> = {};
  const seen = new Set<string>();
  let index = skipFlowSpace(text, start + 1);
  if (text[index] === "}") return { value: result, end: index + 1 };
  for (;;) {
    const { key, end: keyEnd } = parseFlowMappingKey(text, index);
    index = skipFlowSpace(text, keyEnd);
    if (text[index] !== ":") throw new UnsupportedSyntax("expected ':' in flow mapping");
    if (seen.has(key)) throw new UnsupportedSyntax(`duplicate key: ${key}`);
    seen.add(key);
    index = skipFlowSpace(text, index + 1);
    const parsed = parseFlowValue(text, index);
    result[key] = parsed.value;
    index = skipFlowSpace(text, parsed.end);
    const ch = text[index];
    if (ch === ",") {
      index = skipFlowSpace(text, index + 1);
      continue;
    }
    if (ch === "}") return { value: result, end: index + 1 };
    throw new UnsupportedSyntax("malformed flow mapping");
  }
}

export function parseScalarOrFlow(raw: string): JsonValue {
  if (raw.length === 0) return null;
  const first = raw[0]!;
  if (first === "[") {
    const { value, end } = parseFlowSequenceAt(raw, 0);
    if (end !== raw.length) throw new UnsupportedSyntax("trailing content after flow sequence");
    return value;
  }
  if (first === "{") {
    const { value, end } = parseFlowMappingAt(raw, 0);
    if (end !== raw.length) throw new UnsupportedSyntax("trailing content after flow mapping");
    return value;
  }
  if (first === '"') {
    const end = findDoubleQuotedEnd(raw, 0);
    if (end !== raw.length) throw new UnsupportedSyntax("trailing content after quoted scalar");
    return parseDoubleQuoted(raw);
  }
  if (first === "'") {
    const end = findSingleQuotedEnd(raw, 0);
    if (end !== raw.length) throw new UnsupportedSyntax("trailing content after quoted scalar");
    return parseSingleQuoted(raw);
  }
  if (first === "&" || first === "*" || first === "!")
    throw new UnsupportedSyntax(`unsupported YAML construct: ${raw}`);
  if (/^[|>][+-]?[0-9]*$/u.test(raw))
    throw new UnsupportedSyntax("block scalars are not supported");
  return parsePlainScalar(raw);
}

export function parseKeyScalar(raw: string): string {
  if (raw.length === 0) throw new UnsupportedSyntax("empty mapping key");
  if (raw[0] === '"') return parseDoubleQuoted(raw);
  if (raw[0] === "'") return parseSingleQuoted(raw);
  if (/^[&*!?]/u.test(raw)) throw new UnsupportedSyntax(`unsupported mapping key: ${raw}`);
  return raw;
}

export const parseScalar = parseScalarOrFlow;
