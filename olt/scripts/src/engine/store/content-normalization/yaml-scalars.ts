import type { JsonValue } from "../../../core/contracts/index.ts";
import {
  UnsupportedSyntax,
  type FlowResult,
  findDoubleQuotedEnd,
  findSingleQuotedEnd,
  parseDoubleQuoted,
  parseSingleQuoted,
  skipFlowSpace,
  findPlainFlowScalarEnd,
  parseFlowValue,
  parseFlowSequenceAt,
  parseFlowMappingKey,
  parseFlowMappingAt,
  parseScalarOrFlow,
  parseKeyScalar,
  parseScalar,
  parsePlainScalarValue,
} from "./yaml-flow.ts";

export {
  UnsupportedSyntax,
  type FlowResult,
  findDoubleQuotedEnd,
  findSingleQuotedEnd,
  parseDoubleQuoted,
  parseSingleQuoted,
  skipFlowSpace,
  findPlainFlowScalarEnd,
  parseFlowValue,
  parseFlowSequenceAt,
  parseFlowMappingKey,
  parseFlowMappingAt,
  parseScalarOrFlow,
  parseKeyScalar,
  parseScalar,
};

export interface Line {
  indent: number;
  content: string;
}

export interface ParseResult {
  value: JsonValue;
  next: number;
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
  const rawLines = normalized.split("\n");
  const result: Line[] = [];
  for (const raw of rawLines) {
    const withoutComment = stripComment(raw);
    const trimmedRight = withoutComment.replace(/[ \t]+$/u, "");
    if (trimmedRight.trim().length === 0) continue;
    let indent = 0;
    while (indent < trimmedRight.length && trimmedRight[indent] === " ") indent += 1;
    if (indent < trimmedRight.length && trimmedRight[indent] === "\t") {
      throw new UnsupportedSyntax("tabs are not allowed for indentation");
    }
    result.push({ indent, content: trimmedRight.slice(indent) });
  }
  return result;
}

export function parsePlainScalar(raw: string): JsonValue {
  return parsePlainScalarValue(raw);
}

export function isSequenceItem(content: string): boolean {
  return content === "-" || content.startsWith("- ");
}

export function findKeyColon(content: string): number {
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
    if (ch === ":") {
      const next = content[index + 1];
      if (next === undefined || next === " " || next === "\t") return index;
    }
  }
  return -1;
}

export function isMappingKeyLine(content: string): boolean {
  return findKeyColon(content) >= 0;
}
