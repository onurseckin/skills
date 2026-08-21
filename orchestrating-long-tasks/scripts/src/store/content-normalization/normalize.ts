import { sha256Bytes } from "../../core/json.ts";
import { detectContentFormat, type ContentFormat } from "./format.ts";
import { canonicalizeJson, canonicalizeJsonl } from "./json-canonical.ts";
import { canonicalizeEcmaScriptWhitespace } from "./ecmascript-whitespace.ts";
import { canonicalizeYaml } from "./yaml-canonical.ts";

export type NormalizationMethod =
  | "json-canonical"
  | "jsonl-canonical"
  | "yaml-canonical"
  | "typescript-whitespace"
  | "byte-identical";

export interface NormalizationResult {
  method: NormalizationMethod;
  normalized: Uint8Array;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

function canonicalizeByFormat(bytes: Uint8Array, format: ContentFormat): NormalizationResult {
  if (format === "json") {
    const canonical = canonicalizeJson(bytes);
    if (canonical !== undefined) return { method: "json-canonical", normalized: canonical };
  } else if (format === "jsonl") {
    const canonical = canonicalizeJsonl(bytes);
    if (canonical !== undefined) return { method: "jsonl-canonical", normalized: canonical };
  } else if (format === "yaml") {
    const canonical = canonicalizeYaml(bytes);
    if (canonical !== undefined) return { method: "yaml-canonical", normalized: canonical };
  } else if (format === "typescript") {
    try {
      const text = decoder.decode(bytes);
      const canonical = canonicalizeEcmaScriptWhitespace(text);
      if (canonical !== undefined)
        return { method: "typescript-whitespace", normalized: encoder.encode(canonical) };
    } catch {
      return { method: "byte-identical", normalized: bytes };
    }
  }
  return { method: "byte-identical", normalized: bytes };
}

export function normalizeContent(
  bytes: Uint8Array,
  filenameOrFormat: string | ContentFormat,
): NormalizationResult {
  const format: ContentFormat =
    filenameOrFormat === "json" ||
    filenameOrFormat === "jsonl" ||
    filenameOrFormat === "yaml" ||
    filenameOrFormat === "typescript" ||
    filenameOrFormat === "unknown"
      ? filenameOrFormat
      : detectContentFormat(filenameOrFormat);
  return canonicalizeByFormat(bytes, format);
}

export interface ContentDigest {
  sha256: string;
  method: NormalizationMethod;
}

export function contentDigest(
  bytes: Uint8Array,
  filenameOrFormat: string | ContentFormat,
): ContentDigest {
  const { method, normalized } = normalizeContent(bytes, filenameOrFormat);
  return { sha256: sha256Bytes(normalized), method };
}

export interface ContentComparison {
  equal: boolean;
  leftMethod: NormalizationMethod;
  rightMethod: NormalizationMethod;
}

export function contentEquals(
  left: Uint8Array,
  right: Uint8Array,
  filenameOrFormat: string | ContentFormat,
): ContentComparison {
  const leftDigest = contentDigest(left, filenameOrFormat);
  const rightDigest = contentDigest(right, filenameOrFormat);
  return {
    equal: leftDigest.sha256 === rightDigest.sha256,
    leftMethod: leftDigest.method,
    rightMethod: rightDigest.method,
  };
}
