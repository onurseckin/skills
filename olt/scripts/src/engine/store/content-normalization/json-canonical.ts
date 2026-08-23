import { canonicalJsonBytes, parseJsonBytes } from "../../../core/json.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function canonicalizeJson(bytes: Uint8Array): Uint8Array | undefined {
  try {
    return canonicalJsonBytes(parseJsonBytes(bytes, "content"));
  } catch {
    return undefined;
  }
}

function splitLines(text: string): string[] {
  const withoutTrailingNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutTrailingNewline.length === 0 ? [] : withoutTrailingNewline.split("\n");
}

export function canonicalizeJsonl(bytes: Uint8Array): Uint8Array | undefined {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  const lines = splitLines(text.replaceAll("\r\n", "\n"));
  const canonicalLines: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = parseJsonBytes(encoder.encode(line), "jsonl line");
      canonicalLines.push(decoder.decode(canonicalJsonBytes(parsed)));
    } catch {
      return undefined;
    }
  }
  return encoder.encode(canonicalLines.length === 0 ? "" : `${canonicalLines.join("\n")}\n`);
}
