import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export interface DataReferencePorts {
  readonly readFile: (filePath: string) => string;
  readonly exists: (filePath: string) => boolean;
}

export interface DataReferenceOptions {
  readonly repoRoot?: string;
  readonly ports?: DataReferencePorts;
  readonly maxPrefixShare?: number;
}

export type DataReferenceIndex = ReadonlyMap<string, readonly string[]>;

export const DEFAULT_MAX_PREFIX_SHARE = 0.1;
export const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx)$/;
export const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx)$/;

const PATH_CALL_PATTERN = /\b(?:join|resolve)\s*\(/g;
const BINDING_PATTERN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
const LITERAL_PATH_PATTERN = /["'`]([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@ -]+)+)["'`]/g;
const STRING_LITERAL_PATTERN = /^["'`]([^"'`]*)["'`]$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const MAX_EXPRESSION_DEPTH = 6;

const defaultPorts: DataReferencePorts = {
  readFile: (filePath) => {
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  },
  exists: (filePath) => {
    try {
      return existsSync(filePath);
    } catch {
      return false;
    }
  },
};

export function splitTopLevelArguments(argumentText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote = "";
  for (const char of argumentText) {
    if (quote !== "") {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

export function extractCallArguments(source: string, openIndex: number): string | null {
  let depth = 0;
  let quote = "";
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote !== "") {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

export interface ExpressionScope {
  readonly bindings: Map<string, string | null>;
  readonly selfDirectory: string;
}

function joinSegments(base: string | null, piece: string): string {
  return base === null ? piece : join(base, piece);
}

function resolveArgumentList(
  argumentText: string,
  scope: ExpressionScope,
  depth: number,
): string | null {
  const parts = splitTopLevelArguments(argumentText);
  let current: string | null = null;
  for (const part of parts) {
    const piece = resolvePathExpression(part, scope, depth + 1);
    if (piece === null) return null;
    current = joinSegments(current, piece);
  }
  return current;
}

export function resolvePathExpression(
  expression: string,
  scope: ExpressionScope,
  depth = 0,
): string | null {
  if (depth > MAX_EXPRESSION_DEPTH) return null;
  const trimmed = expression.trim();
  const literal = trimmed.match(STRING_LITERAL_PATTERN);
  if (literal?.[1] !== undefined) return literal[1];
  if (trimmed === "process.cwd()") return "";
  if (trimmed === "import.meta.dir" || trimmed === "__dirname") return scope.selfDirectory;
  const callMatch = trimmed.match(/^(join|resolve|dirname|normalize)\s*\(/);
  if (callMatch) {
    const args = extractCallArguments(trimmed, trimmed.indexOf("("));
    if (args === null) return null;
    if (callMatch[1] === "dirname") {
      const inner = resolvePathExpression(args, scope, depth + 1);
      return inner === null ? null : dirname(inner);
    }
    if (callMatch[1] === "normalize") {
      const inner = resolvePathExpression(args, scope, depth + 1);
      return inner === null ? null : normalize(inner);
    }
    return resolveArgumentList(args, scope, depth);
  }
  if (IDENTIFIER_PATTERN.test(trimmed)) return scope.bindings.get(trimmed) ?? null;
  return null;
}

export function collectBindings(source: string, selfDirectory: string): Map<string, string | null> {
  const bindings = new Map<string, string | null>();
  const scope: ExpressionScope = { bindings, selfDirectory };
  for (let pass = 0; pass < 3; pass += 1) {
    BINDING_PATTERN.lastIndex = 0;
    let match = BINDING_PATTERN.exec(source);
    while (match !== null) {
      const name = match[1];
      const value = match[2];
      const resolved = name === undefined ? null : (bindings.get(name) ?? null);
      if (name !== undefined && value !== undefined && resolved === null) {
        bindings.set(name, resolvePathExpression(value, scope));
      }
      match = BINDING_PATTERN.exec(source);
    }
  }
  return bindings;
}

export function extractPathCandidates(source: string, selfDirectory: string): string[] {
  const bindings = collectBindings(source, selfDirectory);
  const scope: ExpressionScope = { bindings, selfDirectory };
  const candidates = new Set<string>();
  PATH_CALL_PATTERN.lastIndex = 0;
  let call = PATH_CALL_PATTERN.exec(source);
  while (call !== null) {
    const openIndex = source.indexOf("(", call.index);
    const args = openIndex === -1 ? null : extractCallArguments(source, openIndex);
    if (args !== null) {
      const resolved = resolveArgumentList(args, scope, 0);
      if (resolved !== null) candidates.add(resolved);
    }
    call = PATH_CALL_PATTERN.exec(source);
  }
  for (const value of bindings.values()) {
    if (value !== null && value.includes("/")) candidates.add(value);
  }
  for (const literal of source.matchAll(LITERAL_PATH_PATTERN)) {
    if (literal[1] !== undefined) candidates.add(literal[1]);
  }
  return Array.from(candidates);
}

export function normalizePrefix(candidate: string): string {
  return normalize(candidate).replace(/\/+$/, "");
}

export function isSelectablePrefix(candidate: string): boolean {
  if (candidate === "" || isAbsolute(candidate)) return false;
  const normalized = normalizePrefix(candidate);
  if (normalized === "" || normalized === "." || normalized.startsWith("..")) return false;
  if (normalized === "node_modules" || normalized.startsWith("node_modules/")) return false;
  if (normalized === ".git" || normalized.startsWith(".git/")) return false;
  return !TEST_FILE_PATTERN.test(normalized);
}

function toRepoRelative(filePath: string, repoRoot: string): string {
  return relative(repoRoot, resolve(repoRoot, filePath)).split("\\").join("/");
}

export function collectDataReferences(
  testFile: string,
  options: DataReferenceOptions = {},
): string[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const ports = options.ports ?? defaultPorts;
  const relativeTest = toRepoRelative(testFile, repoRoot);
  const source = ports.readFile(resolve(repoRoot, relativeTest));
  const references = new Set<string>();
  for (const candidate of extractPathCandidates(source, dirname(relativeTest))) {
    if (!isSelectablePrefix(candidate)) continue;
    const normalized = normalizePrefix(candidate);
    if (ports.exists(resolve(repoRoot, normalized))) references.add(normalized);
  }
  return Array.from(references).sort();
}

export function buildDataReferenceIndex(
  testFiles: readonly string[],
  options: DataReferenceOptions = {},
): DataReferenceIndex {
  const repoRoot = options.repoRoot ?? process.cwd();
  const draft = new Map<string, string[]>();
  for (const testFile of testFiles) {
    const relativeTest = toRepoRelative(testFile, repoRoot);
    for (const reference of collectDataReferences(testFile, options)) {
      const bucket = draft.get(reference);
      if (bucket) bucket.push(relativeTest);
      else draft.set(reference, [relativeTest]);
    }
  }
  const share = options.maxPrefixShare ?? DEFAULT_MAX_PREFIX_SHARE;
  const cap = Math.max(1, Math.floor(testFiles.length * share));
  const index = new Map<string, readonly string[]>();
  for (const [reference, tests] of draft) if (tests.length <= cap) index.set(reference, tests);
  return index;
}

export function isDataFile(filePath: string): boolean {
  return !CODE_FILE_PATTERN.test(filePath);
}

export function selectTestsForDataFile(
  changedFile: string,
  index: DataReferenceIndex,
): readonly string[] {
  const selected = new Set<string>();
  const normalized = normalizePrefix(changedFile);
  for (const [reference, tests] of index) {
    if (normalized === reference || normalized.startsWith(`${reference}/`)) {
      for (const test of tests) selected.add(test);
    }
  }
  return Array.from(selected).sort();
}
