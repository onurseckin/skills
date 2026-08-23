import { canonicalizeYaml } from "../../engine/store/content-normalization/yaml-canonical.ts";

export function parseYamlOrJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return {};

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fallback to YAML parser if JSON parse fails
    }
  }

  const encoded = new TextEncoder().encode(rawText);
  const canonicalBytes = canonicalizeYaml(encoded);
  if (canonicalBytes !== undefined) {
    const jsonString = new TextDecoder("utf-8").decode(canonicalBytes);
    return JSON.parse(jsonString);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML/JSON capture configuration: ${message}`);
  }
}
