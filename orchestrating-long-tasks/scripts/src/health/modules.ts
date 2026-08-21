import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";
import { lineOf } from "./scanner.ts";
import type { SourceFile } from "./sources.ts";

export type ExportKind =
  | "function"
  | "value"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "default"
  | "reexport";

export interface ImportBinding {
  readonly imported: string;
  readonly local: string;
  readonly from: string;
  readonly line: number;
}

export interface ExportRecord {
  readonly name: string;
  readonly kind: ExportKind;
  readonly line: number;
  readonly origin?: { readonly module: string; readonly name: string };
}

export interface ModuleRecord {
  readonly path: string;
  readonly relative: string;
  readonly source: SourceFile;
  readonly imports: readonly ImportBinding[];
  readonly exports: readonly ExportRecord[];
  readonly starReexports: readonly string[];
}

function resolveSpecifier(fromFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) return candidate;
  }
  return base;
}

function bindingsFromClause(clause: string): Array<{ imported: string; local: string }> {
  const bindings: Array<{ imported: string; local: string }> = [];
  const namespaceLocal = /\*\s*as\s+([A-Za-z0-9_$]+)/u.exec(clause)?.[1];
  if (namespaceLocal !== undefined) bindings.push({ imported: "*", local: namespaceLocal });
  const braced = /\{([\s\S]*)\}/u.exec(clause);
  if (braced) {
    for (const entry of (braced[1] ?? "").split(",")) {
      const cleaned = entry.replace(/\btype\b/gu, "").trim();
      if (!cleaned) continue;
      const aliased = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/u.exec(cleaned);
      if (aliased) bindings.push({ imported: aliased[1] ?? "", local: aliased[2] ?? "" });
      else bindings.push({ imported: cleaned, local: cleaned });
    }
  }
  const defaultBinding = /^\s*(?:type\s+)?([A-Za-z0-9_$]+)\s*(?:,|$)/u.exec(
    clause.replace(/\{[\s\S]*\}/u, "").replace(/\*\s*as\s+[A-Za-z0-9_$]+/u, ""),
  );
  if (defaultBinding?.[1]) bindings.push({ imported: "default", local: defaultBinding[1] });
  return bindings;
}

const IMPORT_PATTERN = /^import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/gmu;

function parseImports(file: SourceFile): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const code = file.scan.code;
  for (const match of code.matchAll(IMPORT_PATTERN)) {
    const clause = (match[1] ?? "").replace(/^type\s+/u, "");
    const from = resolveSpecifier(file.path, match[2] ?? "");
    const line = lineOf(code, match.index);
    for (const binding of bindingsFromClause(clause)) {
      bindings.push({ ...binding, from, line });
    }
  }
  return bindings;
}

const DECLARATION_PATTERNS: ReadonlyArray<readonly [RegExp, ExportKind]> = [
  [/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)/gmu, "function"],
  [/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gmu, "value"],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/gmu, "class"],
  [/^export\s+interface\s+([A-Za-z0-9_$]+)/gmu, "interface"],
  [/^export\s+type\s+([A-Za-z0-9_$]+)\s*[=<]/gmu, "type"],
  [/^export\s+(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/gmu, "enum"],
];

const REEXPORT_PATTERN = /^export\s+(?:type\s+)?\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?/gmu;
const STAR_PATTERN = /^export\s*\*\s*from\s*["']([^"']+)["']/gmu;

function parseExports(file: SourceFile): { exports: ExportRecord[]; stars: string[] } {
  const code = file.scan.code;
  const exports: ExportRecord[] = [];
  for (const [pattern, kind] of DECLARATION_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      exports.push({ name: match[1] ?? "", kind, line: lineOf(code, match.index) });
    }
  }
  if (/^export\s+default\b/mu.test(code)) {
    exports.push({
      name: "default",
      kind: "default",
      line: lineOf(code, code.indexOf("export default")),
    });
  }
  for (const match of code.matchAll(REEXPORT_PATTERN)) {
    const specifier = match[2];
    const line = lineOf(code, match.index);
    for (const binding of bindingsFromClause(`{${match[1] ?? ""}}`)) {
      const origin =
        specifier === undefined
          ? undefined
          : { module: resolveSpecifier(file.path, specifier), name: binding.imported };
      exports.push({
        name: binding.local,
        kind: "reexport",
        line,
        ...(origin === undefined ? {} : { origin }),
      });
    }
  }
  const stars = [...code.matchAll(STAR_PATTERN)].map((match) =>
    resolveSpecifier(file.path, match[1] ?? ""),
  );
  return { exports, stars };
}

export function buildModules(files: readonly SourceFile[]): Map<string, ModuleRecord> {
  const modules = new Map<string, ModuleRecord>();
  for (const file of files) {
    const { exports, stars } = parseExports(file);
    modules.set(file.path, {
      path: file.path,
      relative: file.relative,
      source: file,
      imports: parseImports(file),
      exports,
      starReexports: stars,
    });
  }
  return modules;
}

export interface SymbolRef {
  readonly module: string;
  readonly name: string;
}

export function resolveOrigin(
  modules: ReadonlyMap<string, ModuleRecord>,
  ref: SymbolRef,
  seen: ReadonlySet<string> = new Set(),
): SymbolRef {
  const key = `${ref.module}#${ref.name}`;
  if (seen.has(key)) return ref;
  const record = modules.get(ref.module);
  if (record === undefined) return ref;
  const forwarded = record.exports.find(
    (entry) => entry.name === ref.name && entry.origin !== undefined,
  );
  const nextSeen = new Set([...seen, key]);
  if (forwarded?.origin !== undefined) {
    return resolveOrigin(
      modules,
      { module: forwarded.origin.module, name: forwarded.origin.name },
      nextSeen,
    );
  }
  const declared = record.exports.some((entry) => entry.name === ref.name);
  if (declared) return ref;
  for (const star of record.starReexports) {
    const candidate = modules.get(star);
    if (candidate === undefined) continue;
    const resolved = resolveOrigin(modules, { module: star, name: ref.name }, nextSeen);
    if (resolved.module !== star || candidate.exports.some((entry) => entry.name === ref.name)) {
      return resolved;
    }
  }
  return ref;
}
