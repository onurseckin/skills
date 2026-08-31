import type { AnchorSymbol } from "./types.ts";
import { findBalancedBlock } from "./scanner.ts";

const PY_EXTENSIONS = new Set(["py", "python"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const SHELL_EXTENSIONS = new Set(["sh", "bash", "zsh"]);
const RUST_EXTENSIONS = new Set(["rs"]);
const GO_EXTENSIONS = new Set(["go"]);

function getLeadingSpaces(line: string): number {
  const match = line.match(/^(\s*)/);
  return match !== null && match[1] !== undefined ? match[1].length : 0;
}

function findPythonBlockBoundary(
  lines: readonly string[],
  startLineIndex: number,
): { endLine: number } {
  const baseIndent = getLeadingSpaces(lines[startLineIndex] ?? "");
  let lastBodyIndex = startLineIndex;

  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const currentIndent = getLeadingSpaces(line);
    if (currentIndent > baseIndent) {
      lastBodyIndex = i;
    } else {
      break;
    }
  }

  return { endLine: lastBodyIndex + 1 };
}

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

    // Python functions & classes with indentation-aware boundary tracking
    if (ext !== undefined && PY_EXTENSIONS.has(ext)) {
      const pyFuncMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (pyFuncMatch !== null && pyFuncMatch[1] !== undefined) {
        const boundary = findPythonBlockBoundary(lines, i);
        symbols.push({
          name: pyFuncMatch[1],
          kind: "function",
          startLine: lineNum,
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
          endLine: boundary.endLine,
          signature: trimmed,
          exported: !pyFuncMatch[1].startsWith("_"),
        });
        continue;
      }
      const pyClassMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (pyClassMatch !== null && pyClassMatch[1] !== undefined) {
        const boundary = findPythonBlockBoundary(lines, i);
        symbols.push({
          name: pyClassMatch[1],
          kind: "class",
          startLine: lineNum,
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
          endLine: boundary.endLine,
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
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
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
        const boundary = findBalancedBlock(lines, i);
        symbols.push({
          name: shMatch[1],
          kind: "function",
          startLine: lineNum,
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
          endLine: boundary.endLine,
          signature: trimmed,
          exported: true,
        });
        continue;
      }
    }

    // Rust functions and structs
    if (ext !== undefined && RUST_EXTENSIONS.has(ext)) {
      const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/);
      if (fnMatch !== null && fnMatch[1] !== undefined) {
        const boundary = findBalancedBlock(lines, i);
        symbols.push({
          name: fnMatch[1],
          kind: "function",
          startLine: lineNum,
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
          endLine: boundary.endLine,
          signature: trimmed,
          exported: trimmed.startsWith("pub "),
        });
        continue;
      }
    }

    // Go functions and types
    if (ext !== undefined && GO_EXTENSIONS.has(ext)) {
      const goFuncMatch = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
      if (goFuncMatch !== null && goFuncMatch[1] !== undefined) {
        const isExported = /^[A-Z]/.test(goFuncMatch[1]);
        const boundary = findBalancedBlock(lines, i);
        symbols.push({
          name: goFuncMatch[1],
          kind: "function",
          startLine: lineNum,
          declarationStartLine: lineNum,
          enclosingStartLine: lineNum,
          endLine: boundary.endLine,
          signature: trimmed,
          exported: isExported,
        });
        continue;
      }
    }
  }

  return symbols;
}
