export type ContentFormat = "json" | "jsonl" | "yaml" | "typescript" | "unknown";

const EXTENSION_FORMATS: Readonly<Record<string, ContentFormat>> = {
  ".json": "json",
  ".jsonl": "jsonl",
  ".ndjson": "jsonl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
};

export function detectContentFormat(name: string): ContentFormat {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "unknown";
  return EXTENSION_FORMATS[lower.slice(dot)] ?? "unknown";
}
