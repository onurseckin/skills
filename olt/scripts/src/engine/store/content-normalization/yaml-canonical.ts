import { canonicalJsonBytes } from "../../../core/json.ts";
import type { JsonValue } from "../../../core/contracts/index.ts";
import {
  UnsupportedSyntax,
  splitLines,
  isSequenceItem,
  isMappingKeyLine,
  findKeyColon,
  parseKeyScalar,
  parseScalarOrFlow,
  type Line,
  type ParseResult,
} from "./yaml-scalars.ts";

function parseInlineContinuation(
  lines: readonly Line[],
  index: number,
  virtualIndent: number,
  remainder: string,
): ParseResult {
  const sub: Line[] = [{ indent: virtualIndent, content: remainder }, ...lines.slice(index + 1)];
  if (isSequenceItem(remainder)) {
    const result = parseSequence(sub, 0, virtualIndent);
    return { value: result.value, next: index + result.next };
  }
  if (isMappingKeyLine(remainder)) {
    const result = parseMapping(sub, 0, virtualIndent);
    return { value: result.value, next: index + result.next };
  }
  if (index + 1 < lines.length && lines[index + 1]!.indent >= virtualIndent)
    throw new UnsupportedSyntax("unexpected nested content under a scalar");
  return { value: parseScalarOrFlow(remainder), next: index + 1 };
}

function parseSequence(lines: readonly Line[], start: number, indent: number): ParseResult {
  const items: JsonValue[] = [];
  let index = start;
  while (
    index < lines.length &&
    lines[index]!.indent === indent &&
    isSequenceItem(lines[index]!.content)
  ) {
    const line = lines[index]!;
    const afterDash = line.content.slice(1);
    const spaceCount = afterDash.length - afterDash.trimStart().length;
    const remainder = afterDash.trimStart();
    if (remainder.length === 0) {
      if (index + 1 < lines.length && lines[index + 1]!.indent > indent) {
        const nested = parseBlock(lines, index + 1, lines[index + 1]!.indent);
        items.push(nested.value);
        index = nested.next;
      } else {
        items.push(null);
        index += 1;
      }
      continue;
    }
    const virtualIndent = indent + 1 + spaceCount;
    const nested = parseInlineContinuation(lines, index, virtualIndent, remainder);
    items.push(nested.value);
    index = nested.next;
  }
  return { value: items, next: index };
}

function parseMapping(lines: readonly Line[], start: number, indent: number): ParseResult {
  const result: Record<string, JsonValue> = {};
  const seen = new Set<string>();
  let index = start;
  while (
    index < lines.length &&
    lines[index]!.indent === indent &&
    isMappingKeyLine(lines[index]!.content)
  ) {
    const line = lines[index]!;
    const colon = findKeyColon(line.content)!;
    const key = parseKeyScalar(line.content.slice(0, colon).trim());
    const rawValue = line.content.slice(colon + 1).trim();
    if (seen.has(key)) throw new UnsupportedSyntax(`duplicate key: ${key}`);
    seen.add(key);
    if (rawValue.length === 0) {
      if (index + 1 < lines.length && lines[index + 1]!.indent > indent) {
        const nested = parseBlock(lines, index + 1, lines[index + 1]!.indent);
        result[key] = nested.value;
        index = nested.next;
      } else {
        result[key] = null;
        index += 1;
      }
    } else {
      result[key] = parseScalarOrFlow(rawValue);
      index += 1;
    }
  }
  return { value: result, next: index };
}

function parseBlock(lines: readonly Line[], start: number, indent: number): ParseResult {
  if (start >= lines.length) throw new UnsupportedSyntax("expected a value");
  const first = lines[start]!;
  if (first.indent !== indent) throw new UnsupportedSyntax("inconsistent indentation");
  if (isSequenceItem(first.content)) return parseSequence(lines, start, indent);
  if (isMappingKeyLine(first.content)) return parseMapping(lines, start, indent);
  if (start + 1 < lines.length && lines[start + 1]!.indent > indent)
    throw new UnsupportedSyntax("unexpected nested content under a scalar");
  return { value: parseScalarOrFlow(first.content), next: start + 1 };
}

export function canonicalizeYaml(bytes: Uint8Array): Uint8Array | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  try {
    const lines = splitLines(text);
    if (lines.length === 0) return canonicalJsonBytes(null);
    const result = parseBlock(lines, 0, lines[0]!.indent);
    if (result.next !== lines.length)
      throw new UnsupportedSyntax("trailing content after document");
    return canonicalJsonBytes(result.value);
  } catch (error) {
    if (error instanceof UnsupportedSyntax) return undefined;
    throw error;
  }
}
