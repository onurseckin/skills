import ts from "typescript";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

/**
 * Kind of symbol recognized by the briefing builder anchor extractor.
 */
export type AnchorSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "const"
  | "enum"
  | "method"
  | "property"
  | "other";

/**
 * Symbol metadata extracted from a code source file.
 */
export interface AnchorSymbol {
  readonly name: string;
  readonly kind: AnchorSymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature?: string | undefined;
  readonly exported?: boolean | undefined;
  readonly docstring?: string | undefined;
}

/**
 * Exact code anchor representing a precise location, line range, and replacement target.
 */
export interface ExactAnchor {
  readonly filePath: string;
  readonly symbolName?: string | undefined;
  readonly symbolKind?: AnchorSymbolKind | undefined;
  readonly startLine: number;
  readonly endLine: number;
  readonly contextSnippet: string;
  readonly replacementTarget?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Options for file anchor extraction.
 */
export interface AnchorOptions {
  readonly targetSymbols?: readonly string[] | undefined;
  readonly maxSnippetLines?: number | undefined;
  readonly includeContext?: boolean | undefined;
  readonly contextLines?: number | undefined;
  readonly baseDir?: string | undefined;
}

/**
 * Input options for building a zero-exploration exact-anchor briefing.
 */
export interface ExactAnchorBriefingOptions {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly targetFiles?: readonly string[] | undefined;
  readonly gateCommands?: readonly string[] | undefined;
  readonly acceptanceCriteria?: readonly string[] | undefined;
  readonly promptContext?: string | undefined;
  readonly recommendedCommands?: readonly string[] | undefined;
  readonly targetSymbols?: readonly string[] | undefined;
  readonly baseDir?: string | undefined;
}

/**
 * Result structure of a zero-exploration exact-anchor briefing.
 */
export interface ExactAnchorBriefing {
  readonly taskId: string;
  readonly label: string;
  readonly markdown: string;
  readonly writeScope: readonly string[];
  readonly targetFiles: readonly string[];
  readonly anchors: readonly ExactAnchor[];
  readonly symbols: readonly AnchorSymbol[];
  readonly gateCommands: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly recommendedCommands: readonly string[];
  readonly waitMsMandate: number;
}

const TS_JS_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

const TEST_FILE_EXTENSIONS: readonly string[] = [
  ".test.ts",
  ".spec.ts",
  ".test.js",
  ".spec.js",
  ".test.tsx",
  ".spec.tsx",
] as const;

const TEST_GATE_PREFIXES: readonly string[] = [
  "bun test",
  "npm test",
  "pytest",
  "cargo test",
] as const;

const BLOCK_END_DELIMITERS = new Set(["}", "};", ");", ") {"]);
const PY_EXTENSIONS = new Set(["py", "python"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const SHELL_EXTENSIONS = new Set(["sh", "bash", "zsh"]);

/**
 * Resolve a file path against an optional base directory or cwd.
 */
function resolveFilePath(filePath: string, baseDir?: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  const root = baseDir !== undefined && baseDir.trim().length > 0 ? baseDir : process.cwd();
  return resolve(root, filePath);
}

/**
 * Helper to determine if a file is a TypeScript/JavaScript source file.
 */
function isTypeScriptOrJavaScript(filePath: string): boolean {
  for (const ext of TS_JS_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Helper to extract signature from a function-like node.
 */
function extractFunctionLikeSignature(node: ts.Node, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  const braceIndex = text.indexOf("{");
  if (braceIndex > 0) {
    return text.substring(0, braceIndex).trim();
  }
  const semiIndex = text.indexOf(";");
  if (semiIndex > 0) {
    return text.substring(0, semiIndex).trim();
  }
  const firstLine = text.split("\n")[0];
  return firstLine !== undefined ? firstLine.trim() : text.trim();
}

/**
 * Helper to extract a clean signature string from an AST node.
 */
function extractNodeSignature(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isFunctionDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isMethodDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isMethodSignature(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    return extractFunctionLikeSignature(node, sourceFile);
  }
  if (ts.isInterfaceDeclaration(node)) {
    const text = node.getText(sourceFile);
    const braceIndex = text.indexOf("{");
    if (braceIndex > 0) {
      return text.substring(0, braceIndex).trim();
    }
    return `interface ${node.name.text}`;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const text = node.getText(sourceFile);
    const eqIndex = text.indexOf("=");
    if (eqIndex > 0) {
      const typePart = text.substring(eqIndex + 1).trim();
      const firstLine = typePart.split("\n")[0];
      const preview = firstLine !== undefined ? firstLine.trim() : "";
      return `type ${node.name.text} = ${preview.length > 50 ? preview.substring(0, 47) + "..." : preview}`;
    }
    return `type ${node.name.text}`;
  }
  if (ts.isClassDeclaration(node)) {
    const text = node.getText(sourceFile);
    const braceIndex = text.indexOf("{");
    if (braceIndex > 0) {
      return text.substring(0, braceIndex).trim();
    }
    return `class ${node.name !== undefined ? node.name.text : "<anonymous>"}`;
  }
  if (ts.isEnumDeclaration(node)) {
    return `enum ${node.name.text}`;
  }
  if (ts.isVariableDeclaration(node)) {
    const name = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
    if (node.type !== undefined) {
      return `${name}: ${node.type.getText(sourceFile)}`;
    }
    return name;
  }
  return undefined;
}

/**
 * Helper to extract docstring comment from an AST node.
 */
function extractNodeDocstring(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const fullText = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (ranges !== undefined && ranges.length > 0) {
    const lastComment = ranges[ranges.length - 1];
    if (lastComment !== undefined && lastComment.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      const commentText = fullText.substring(lastComment.pos, lastComment.end);
      if (commentText.startsWith("/**")) {
        return commentText
          .replace(/^\/\*\*|\*\/$/g, "")
          .split("\n")
          .map((line: string): string => line.replace(/^\s*\*\s?/, "").trim())
          .filter((line: string): boolean => line.length > 0)
          .join(" ");
      }
    }
  }
  return undefined;
}

/**
 * Helper to extract member name from a property/method name node.
 */
function getMemberName(nameNode: ts.PropertyName | undefined, sourceFile: ts.SourceFile): string {
  if (nameNode === undefined) {
    return "<anonymous>";
  }
  if (ts.isIdentifier(nameNode)) {
    return nameNode.text;
  }
  if (ts.isStringLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText(sourceFile);
}

/**
 * Helper to check if an AST node has the export modifier.
 */
function isExportedNode(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    if (modifiers !== undefined) {
      for (const m of modifiers) {
        if (m.kind === ts.SyntaxKind.ExportKeyword) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Extract code symbols from TypeScript/JavaScript source code.
 */
export function extractSymbolsFromSource(
  sourceCode: string,
  fileName?: string,
): readonly AnchorSymbol[] {
  const effectiveFileName = fileName !== undefined ? fileName : "source.ts";
  if (!isTypeScriptOrJavaScript(effectiveFileName)) {
    return extractSymbolsFromGenericSource(sourceCode, effectiveFileName);
  }

  const isJsx = effectiveFileName.endsWith(".tsx") ? true : effectiveFileName.endsWith(".jsx");
  const scriptKind = isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    effectiveFileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const symbols: AnchorSymbol[] = [];

  for (const node of sourceFile.statements) {
    // Function declarations
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name !== undefined ? node.name.text : "<anonymous>";
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);
      symbols.push({
        name,
        kind: "function",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });
      continue;
    }

    // Class declarations
    if (ts.isClassDeclaration(node)) {
      const className = node.name !== undefined ? node.name.text : "<anonymous>";
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: className,
        kind: "class",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });

      // Class members
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member)) {
          const memberName = getMemberName(member.name, sourceFile);
          const mStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.${memberName}`,
            kind: "method",
            startLine: mStart,
            endLine: mEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isPropertyDeclaration(member)) {
          const propName = getMemberName(member.name, sourceFile);
          const pStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const pEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.${propName}`,
            kind: "property",
            startLine: pStart,
            endLine: pEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isConstructorDeclaration(member)) {
          const cStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const cEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${className}.constructor`,
            kind: "method",
            startLine: cStart,
            endLine: cEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        }
      }
      continue;
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const ifaceName = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: ifaceName,
        kind: "interface",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });

      for (const member of node.members) {
        if (ts.isMethodSignature(member)) {
          const memberName = getMemberName(member.name, sourceFile);
          const mStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${ifaceName}.${memberName}`,
            kind: "method",
            startLine: mStart,
            endLine: mEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        } else if (ts.isPropertySignature(member)) {
          const propName = getMemberName(member.name, sourceFile);
          const pStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
          const pEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          symbols.push({
            name: `${ifaceName}.${propName}`,
            kind: "property",
            startLine: pStart,
            endLine: pEnd,
            signature: extractNodeSignature(member, sourceFile),
            docstring: extractNodeDocstring(member, sourceFile),
          });
        }
      }
      continue;
    }

    // Type alias declarations
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);
      symbols.push({
        name,
        kind: "type",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });
      continue;
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      const enumName = node.name.text;
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const exported = isExportedNode(node);

      symbols.push({
        name: enumName,
        kind: "enum",
        startLine,
        endLine,
        signature: extractNodeSignature(node, sourceFile),
        exported,
        docstring: extractNodeDocstring(node, sourceFile),
      });

      for (const member of node.members) {
        const memberName = member.name.getText(sourceFile);
        const mStart =
          sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
        const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        symbols.push({
          name: `${enumName}.${memberName}`,
          kind: "property",
          startLine: mStart,
          endLine: mEnd,
          signature: `${enumName}.${memberName}`,
        });
      }
      continue;
    }

    // Variable statements
    if (ts.isVariableStatement(node)) {
      const exported = isExportedNode(node);
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          let isFn = false;
          if (decl.initializer !== undefined) {
            if (ts.isArrowFunction(decl.initializer)) {
              isFn = true;
            } else if (ts.isFunctionExpression(decl.initializer)) {
              isFn = true;
            }
          }
          const kind: AnchorSymbolKind = isFn ? "function" : isConst ? "const" : "variable";
          const startLine =
            sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;
          const endLine = sourceFile.getLineAndCharacterOfPosition(decl.getEnd()).line + 1;

          symbols.push({
            name,
            kind,
            startLine,
            endLine,
            signature: extractNodeSignature(decl, sourceFile),
            exported,
            docstring: extractNodeDocstring(node, sourceFile),
          });
        }
      }
      continue;
    }
  }

  return symbols;
}

/**
 * Fallback parser for non-TypeScript/JavaScript files (Markdown, Python, Shell, etc.).
 */
function extractSymbolsFromGenericSource(
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

/**
 * Extract symbol definitions from a target file on disk.
 */
export function extractFileSymbols(
  filePath: string,
  targetSymbols?: readonly string[],
  baseDir?: string,
): readonly AnchorSymbol[] {
  const fullPath = resolveFilePath(filePath, baseDir);
  if (!existsSync(fullPath)) {
    return [];
  }
  try {
    if (statSync(fullPath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const content = readFileSync(fullPath, "utf-8");
  const allSymbols = extractSymbolsFromSource(content, basename(filePath));

  if (targetSymbols === undefined) {
    return allSymbols;
  }
  if (targetSymbols.length === 0) {
    return allSymbols;
  }

  const targetSet = new Set(targetSymbols);
  const targetLower = new Set(targetSymbols.map((s: string): string => s.toLowerCase()));

  return allSymbols.filter((sym: AnchorSymbol): boolean => {
    if (targetSet.has(sym.name)) {
      return true;
    }
    const dotPart = sym.name.split(".").pop();
    if (dotPart !== undefined && targetSet.has(dotPart)) {
      return true;
    }
    if (targetLower.has(sym.name.toLowerCase())) {
      return true;
    }
    return false;
  });
}

/**
 * Create a drop-in replacement anchor for an explicit range of code.
 */
export function createDropInAnchor(
  filePath: string,
  startLine: number,
  endLine: number,
  replacementTarget: string,
  description?: string,
): ExactAnchor {
  return {
    filePath,
    startLine,
    endLine,
    contextSnippet: replacementTarget,
    replacementTarget,
    description:
      description !== undefined
        ? description
        : `Drop-in replacement for lines ${startLine}–${endLine}`,
  };
}

/**
 * Find an exact anchor by regex or string search pattern in a file.
 */
export function findAnchorByPattern(
  filePath: string,
  pattern: RegExp | string,
  baseDir?: string,
): ExactAnchor | undefined {
  const fullPath = resolveFilePath(filePath, baseDir);
  if (!existsSync(fullPath)) {
    return undefined;
  }
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && regex.test(line)) {
      const startLine = i + 1;
      let endLine = startLine;
      let j = i;
      while (j < lines.length && j < i + 20) {
        const nextLine = lines[j];
        if (nextLine !== undefined && BLOCK_END_DELIMITERS.has(nextLine.trim())) {
          endLine = j + 1;
          break;
        }
        j++;
      }
      if (endLine === startLine && i + 5 <= lines.length) {
        endLine = Math.min(lines.length, i + 5);
      }
      const slice = lines.slice(startLine - 1, endLine);
      const text = slice.join("\n");
      const patternStr = typeof pattern === "string" ? pattern : pattern.source;
      return {
        filePath,
        startLine,
        endLine,
        contextSnippet: text,
        replacementTarget: text,
        description: `Pattern match anchor for ${patternStr} (lines ${startLine}–${endLine})`,
      };
    }
  }
  return undefined;
}

/**
 * Extract exact code anchors from a target file.
 * Returns exact line ranges, symbol locations, and replacement targets.
 */
export function extractFileAnchors(
  filePath: string,
  targetSymbols?: readonly string[],
  options?: AnchorOptions,
): readonly ExactAnchor[] {
  const baseDir = options !== undefined ? options.baseDir : undefined;
  const fullPath = resolveFilePath(filePath, baseDir);

  if (!existsSync(fullPath)) {
    return [];
  }
  try {
    if (statSync(fullPath).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split(/\r?\n/);
  const maxLines =
    options !== undefined && options.maxSnippetLines !== undefined ? options.maxSnippetLines : 20;

  let effectiveTargets: readonly string[] | undefined = undefined;
  if (targetSymbols !== undefined && targetSymbols.length > 0) {
    effectiveTargets = targetSymbols;
  } else if (options !== undefined && options.targetSymbols !== undefined) {
    effectiveTargets = options.targetSymbols;
  }

  const symbols = extractFileSymbols(filePath, effectiveTargets, baseDir);
  const anchors: ExactAnchor[] = [];

  if (symbols.length > 0) {
    for (const sym of symbols) {
      const startLine = Math.max(1, sym.startLine);
      const endLine = Math.min(lines.length, Math.max(startLine, sym.endLine));
      const snippetLines = lines.slice(startLine - 1, endLine);
      const replacementTarget = snippetLines.join("\n");

      let contextSnippet = replacementTarget;
      if (snippetLines.length > maxLines) {
        const preview = snippetLines.slice(0, maxLines - 5).join("\n");
        contextSnippet = `${preview}\n// ... (${snippetLines.length - (maxLines - 5)} more lines)`;
      }

      anchors.push({
        filePath,
        symbolName: sym.name,
        symbolKind: sym.kind,
        startLine,
        endLine,
        contextSnippet,
        replacementTarget,
        description: `${sym.kind} \`${sym.name}\` (lines ${startLine}–${endLine})`,
      });
    }
    return anchors;
  }

  // If specific target symbols were requested but not matched in AST, try pattern matching
  if (effectiveTargets !== undefined && effectiveTargets.length > 0) {
    for (const target of effectiveTargets) {
      const patternAnchor = findAnchorByPattern(filePath, target, baseDir);
      if (patternAnchor !== undefined) {
        anchors.push(patternAnchor);
      }
    }
    if (anchors.length > 0) {
      return anchors;
    }
  }

  // Fallback for files without matched symbols: anchor the whole file or initial block
  if (lines.length > 0) {
    const endLine = lines.length;
    const snippet =
      lines.length > maxLines
        ? `${lines.slice(0, maxLines - 5).join("\n")}\n// ... (${lines.length - (maxLines - 5)} more lines)`
        : content;

    anchors.push({
      filePath,
      startLine: 1,
      endLine,
      contextSnippet: snippet,
      replacementTarget: content,
      description: `File anchor for ${filePath} (lines 1–${endLine})`,
    });
  }

  return anchors;
}

/**
 * Helper to check if a command is a test gate command.
 */
function isTestGateCommand(command: string): boolean {
  for (const prefix of TEST_GATE_PREFIXES) {
    if (command.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Helper to check if a file path is a test file.
 */
function isTestFilePath(filePath: string): boolean {
  for (const ext of TEST_FILE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Derive recommended file-scoped test commands from target files and gate commands.
 */
export function deriveRecommendedTestCommands(
  targetFiles: readonly string[],
  gateCommands?: readonly string[],
  baseDir?: string,
): readonly string[] {
  const commands: string[] = [];

  // Extract explicit test gate commands
  if (gateCommands !== undefined) {
    for (const gate of gateCommands) {
      if (isTestGateCommand(gate)) {
        if (!commands.includes(gate)) {
          commands.push(gate);
        }
      }
    }
  }

  // Check target files for direct test files or matching unit tests
  for (const file of targetFiles) {
    if (isTestFilePath(file)) {
      const cmd = `bun test ${file}`;
      if (!commands.includes(cmd)) {
        commands.push(cmd);
      }
      continue;
    }

    // Try finding a matching unit test file
    const base = basename(file).replace(/\.(ts|js|tsx|jsx)$/, "");
    const candidatePaths = [
      `tests/unit/mind/${base}.test.ts`,
      `tests/unit/${base}.test.ts`,
      `tests/${base}.test.ts`,
    ];

    for (const candidate of candidatePaths) {
      const full = resolveFilePath(candidate, baseDir);
      if (existsSync(full)) {
        const cmd = `bun test ${candidate}`;
        if (!commands.includes(cmd)) {
          commands.push(cmd);
        }
        break;
      }
    }
  }

  // Ensure typecheck and lint are recommended verification checks
  if (!commands.includes("bun run typecheck")) {
    commands.push("bun run typecheck");
  }
  if (!commands.includes("bun run lint")) {
    commands.push("bun run lint");
  }

  return commands;
}

/**
 * Format a zero-exploration exact-anchor briefing into markdown.
 */
export function formatExactAnchorBriefingMarkdown(
  briefing: Omit<ExactAnchorBriefing, "markdown">,
): string {
  const lines: string[] = [];

  lines.push(`### 🌌 Zero-Exploration Exact-Anchor Briefing: ${briefing.taskId}`);
  lines.push(`- **Task ID**: \`${briefing.taskId}\``);
  lines.push(`- **Label**: ${briefing.label}`);

  const scopeStr =
    briefing.writeScope.length > 0
      ? briefing.writeScope.map((s) => `\`${s}\``).join(", ")
      : "`none`";
  lines.push(`- **Assigned Write Scope**: ${scopeStr}`);
  lines.push(
    `  > ⚠️ **Scope Invariant**: You are STRICTLY confined to modifying files in your assigned write scope. Modifying any other file is a critical integrity violation.`,
  );

  if (briefing.targetFiles.length > 0) {
    const targetsStr = briefing.targetFiles.map((f) => `\`${f}\``).join(", ");
    lines.push(`- **Target Files**: ${targetsStr}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### 📌 Exact Code Anchors & Replacement Targets");

  if (briefing.anchors.length === 0) {
    lines.push(
      "- No existing file anchors extracted. Target files may be newly created within your assigned write scope.",
    );
  } else {
    const groupedByFile = new Map<string, ExactAnchor[]>();
    for (const anchor of briefing.anchors) {
      const existing = groupedByFile.get(anchor.filePath);
      if (existing !== undefined) {
        existing.push(anchor);
      } else {
        groupedByFile.set(anchor.filePath, [anchor]);
      }
    }

    const entries = Array.from(groupedByFile.entries());
    for (const [filePath, fileAnchors] of entries) {
      lines.push(`##### File: \`${filePath}\``);
      for (const anchor of fileAnchors) {
        const desc =
          anchor.description !== undefined
            ? anchor.description
            : `Lines ${anchor.startLine}–${anchor.endLine}`;
        lines.push(`- **Anchor**: ${desc}`);
        lines.push("```typescript");
        lines.push(anchor.contextSnippet);
        lines.push("```");
      }
    }
  }

  if (briefing.symbols.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🗺️ Symbol Map");
    lines.push("| Symbol | Kind | Lines | Exported | Signature |");
    lines.push("| :--- | :--- | :--- | :--- | :--- |");
    for (const sym of briefing.symbols) {
      const expStr = sym.exported === true ? "Yes" : "No";
      const normalizedSig =
        sym.signature !== undefined ? sym.signature.replace(/\s+/g, " ").trim() : undefined;
      const sigStr = normalizedSig !== undefined ? `\`${normalizedSig}\`` : "-";
      lines.push(
        `| \`${sym.name}\` | \`${sym.kind}\` | ${sym.startLine}–${sym.endLine} | ${expStr} | ${sigStr} |`,
      );
    }
  }

  if (briefing.recommendedCommands.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🧪 Recommended Verification Commands");
    for (const cmd of briefing.recommendedCommands) {
      lines.push(`- \`${cmd}\``);
    }
  }

  if (briefing.gateCommands.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("#### 🚪 Gate Commands");
    for (const cmd of briefing.gateCommands) {
      lines.push(`- \`${cmd}\``);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### ✅ Acceptance Criteria");
  for (const ac of briefing.acceptanceCriteria) {
    lines.push(`- ${ac}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("#### ⚡ Mandatory Execution Directives");
  lines.push(
    `1. **WaitMsBeforeAsync Mandate**: Always specify \`WaitMsBeforeAsync: ${briefing.waitMsMandate}\` on all \`run_command\` invocations for deterministic synchronous execution.`,
  );
  lines.push(
    `2. **Disjoint Write Scope Invariant**: Confine 100% of code modifications strictly to assigned write scope (${scopeStr}).`,
  );
  lines.push(
    `3. **Zero 'any' / Zero Suppressions**: 0 \`any\` annotations, 0 \`@ts-ignore\`, 0 \`@ts-expect-error\`, 0 \`eslint-disable\`.`,
  );
  lines.push(
    `4. **Task Submission**: Submit completed task via \`bun ./olt/scripts/harness.ts task:submit --run <run> --task ${briefing.taskId} --agent <agent> --token <token> --summary "<summary>"\`.`,
  );

  return lines.join("\n");
}

/**
 * Filter scope items that represent target file paths.
 */
function isTargetFilePath(item: string): boolean {
  if (item.includes(".")) {
    return true;
  }
  if (!item.endsWith("/")) {
    return true;
  }
  return false;
}

/**
 * Build a zero-exploration exact-anchor briefing for an assigned task.
 */
export function buildExactAnchorBriefing(options: ExactAnchorBriefingOptions): ExactAnchorBriefing {
  const targetFiles =
    options.targetFiles !== undefined && options.targetFiles.length > 0
      ? options.targetFiles
      : options.writeScope.filter(isTargetFilePath);

  const allAnchors: ExactAnchor[] = [];
  const allSymbols: AnchorSymbol[] = [];

  for (const file of targetFiles) {
    const fileAnchors = extractFileAnchors(file, options.targetSymbols, {
      baseDir: options.baseDir,
    });
    for (const anchor of fileAnchors) {
      allAnchors.push(anchor);
    }

    const fileSymbols = extractFileSymbols(file, options.targetSymbols, options.baseDir);
    for (const sym of fileSymbols) {
      allSymbols.push(sym);
    }
  }

  const gateCommands = options.gateCommands !== undefined ? options.gateCommands : [];
  const recommendedCommands =
    options.recommendedCommands !== undefined && options.recommendedCommands.length > 0
      ? options.recommendedCommands
      : deriveRecommendedTestCommands(targetFiles, gateCommands, options.baseDir);

  const defaultCriteria: string[] = [
    `Strict type safety: 0 'any' types, 0 compiler suppressions (@ts-ignore, @ts-expect-error, eslint-disable).`,
    `Strict disjoint write scope: Only modify files in assigned write scope (${options.writeScope.join(", ")}).`,
    `All verification commands pass cleanly with exit code 0.`,
    `Mandate WaitMsBeforeAsync: 10000 on all run_command invocations.`,
  ];

  const acceptanceCriteria =
    options.acceptanceCriteria !== undefined && options.acceptanceCriteria.length > 0
      ? options.acceptanceCriteria
      : defaultCriteria;

  const baseBriefing = {
    taskId: options.taskId,
    label: options.label,
    writeScope: options.writeScope,
    targetFiles,
    anchors: allAnchors,
    symbols: allSymbols,
    gateCommands,
    acceptanceCriteria,
    recommendedCommands,
    waitMsMandate: 10000,
  };

  const markdown = formatExactAnchorBriefingMarkdown(baseBriefing);

  return {
    ...baseBriefing,
    markdown,
  };
}
