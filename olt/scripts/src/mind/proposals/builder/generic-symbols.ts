import type { AnchorSymbol } from "./types.ts";

const PY_EXTENSIONS = new Set(["py", "python"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const SHELL_EXTENSIONS = new Set(["sh", "bash", "zsh"]);

export function extractSymbolsFromGenericSource(
  sourceCode: string,
  fileName?: string,
): readonly AnchorSymbol[] {
  const lines = sourceCode.split(/\r?\n/);
  const symbols: AnchorSymbol[] = [];
  const parts = fileName !== undefined ? fileName.split(".") : [];
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Python functions & classes
    if (ext !== undefined && PY_EXTENSIONS.has(ext)) {
      const pyFuncMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (pyFuncMatch !== null && pyFuncMatch[1] !== undefined) {
        symbols.push({
          name: pyFuncMatch[1],
          kind: "function",
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
          exported: !pyFuncMatch[1].startsWith("_"),
        });
        continue;
      }
      const pyClassMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (pyClassMatch !== null && pyClassMatch[1] !== undefined) {
        symbols.push({
          name: pyClassMatch[1],
          kind: "class",
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
          exported: !pyClassMatch[1].startsWith("_"),
        });
        continue;
      }
    }

    // Markdown headers
    if (ext !== undefined && MARKDOWN_EXTENSIONS.has(ext)) {
      const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (mdMatch !== null && mdMatch[2] !== undefined) {
        symbols.push({
          name: mdMatch[2],
          kind: "other",
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
        });
        continue;
      }
    }

    // Shell script functions
    if (ext !== undefined && SHELL_EXTENSIONS.has(ext)) {
      const shMatch = trimmed.match(/^(?:function\s+)?([a-zA-Z0-9_-]+)\s*\(\)\s*\{/);
      if (shMatch !== null && shMatch[1] !== undefined) {
        symbols.push({
          name: shMatch[1],
          kind: "function",
          startLine: lineNum,
          endLine: lineNum,
          signature: trimmed,
          exported: true,
        });
        continue;
      }
    }
  }

  return symbols;
}
