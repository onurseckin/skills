import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { HarnessError } from "../../../core/errors/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";

export type AstBreachCode =
  | "FEATURE_INVENTION_BLUNDER"
  | "PUBLIC_API_EXPANSION"
  | "SIGNATURE_MUTATION_BREACH"
  | "TYPE_SAFETY_EVASION_BREACH";

export interface AstInvariantBreach {
  readonly code: AstBreachCode;
  readonly message: string;
  readonly symbol?: string;
  readonly expected?: string;
  readonly actual?: string;
}

export interface ExportedSymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
}

export interface CheckAstOptions {
  readonly strict?: boolean;
  readonly throwOnBreach?: boolean;
}

export interface CheckAstResult {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly breaches: readonly AstInvariantBreach[];
  readonly preExports: readonly ExportedSymbolInfo[];
  readonly postExports: readonly ExportedSymbolInfo[];
  readonly addedSymbols: readonly string[];
  readonly removedSymbols: readonly string[];
  readonly mutatedSymbols: readonly string[];
  readonly evasionBreaches: readonly string[];
  readonly summary: string;
}

export class AstInvariantError extends Error {
  public readonly code: AstBreachCode;
  public readonly breaches: readonly AstInvariantBreach[];
  public readonly exitCode = 3;

  public constructor(
    code: AstBreachCode,
    message: string,
    breaches: readonly AstInvariantBreach[] = [],
  ) {
    super(`[${code}] ${message}`);
    this.name = "AstInvariantError";
    this.code = code;
    this.breaches = breaches;
  }
}

export function normalizeSignature(sig: string): string {
  return sig
    .replace(/\s+/g, " ")
    .replace(/\s*([,:;(){}[\]?])\s*/g, "$1")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s*=>\s*/g, " => ")
    .replace(/;\}/g, "}")
    .replace(/,\)/g, ")")
    .trim();
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)
    : false;
}

function extractClassMembers(cls: ts.ClassDeclaration, sf: ts.SourceFile): string[] {
  const members: string[] = [];
  for (const m of cls.members) {
    if (m.name && ts.isPrivateIdentifier(m.name)) continue;
    const isPrivate =
      ts.canHaveModifiers(m) &&
      ts.getModifiers(m)?.some((mod) => mod.kind === ts.SyntaxKind.PrivateKeyword);
    if (isPrivate) continue;
    if ("body" in m && m.body) {
      const start = m.getStart(sf);
      const bodyStart = (m.body as ts.Node).getStart(sf);
      members.push(
        m
          .getText(sf)
          .slice(0, bodyStart - start)
          .trim(),
      );
    } else if (ts.isPropertyDeclaration(m) && m.name) {
      const stat = ts.getModifiers(m)?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)
        ? "static "
        : "";
      const ro = ts.getModifiers(m)?.some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword)
        ? "readonly "
        : "";
      members.push(
        `${stat}${ro}${m.name.getText(sf)}: ${m.type ? m.type.getText(sf) : "implicit"}`,
      );
    } else {
      members.push(m.getText(sf).replace(/;$/, ""));
    }
  }
  return members;
}

function extractNodeSig(
  node: ts.Node,
  sf: ts.SourceFile,
): { kind: string; name: string; signature: string } | undefined {
  if (ts.isFunctionDeclaration(node)) {
    const tp = node.typeParameters
      ? `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>`
      : "";
    const params = node.parameters.map((p) => p.getText(sf)).join(", ");
    const ret = node.type ? node.type.getText(sf) : "implicit";
    return {
      kind: "function",
      name: node.name?.text ?? "default",
      signature: `${tp}(${params}): ${ret}`,
    };
  }
  if (ts.isClassDeclaration(node)) {
    const tp = node.typeParameters
      ? `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>`
      : "";
    const her = node.heritageClauses?.map((h) => h.getText(sf)).join(" ") ?? "";
    const mems = extractClassMembers(node, sf);
    const name = node.name?.text ?? "default";
    return { kind: "class", name, signature: `class ${name}${tp} ${her} { ${mems.join("; ")} }` };
  }
  if (ts.isInterfaceDeclaration(node)) {
    const tp = node.typeParameters
      ? `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>`
      : "";
    const her = node.heritageClauses?.map((h) => h.getText(sf)).join(" ") ?? "";
    const mems = node.members.map((m) => m.getText(sf).replace(/;$/, ""));
    return {
      kind: "interface",
      name: node.name.text,
      signature: `interface ${node.name.text}${tp} ${her} { ${mems.join("; ")} }`,
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    const tp = node.typeParameters
      ? `<${node.typeParameters.map((p) => p.getText(sf)).join(", ")}>`
      : "";
    return {
      kind: "type",
      name: node.name.text,
      signature: `type ${node.name.text}${tp} = ${node.type.getText(sf)}`,
    };
  }
  if (ts.isEnumDeclaration(node)) {
    return {
      kind: "enum",
      name: node.name.text,
      signature: `enum ${node.name.text} { ${node.members.map((m) => m.getText(sf)).join(", ")} }`,
    };
  }
  return undefined;
}

function extractVarSig(decl: ts.VariableDeclaration, sf: ts.SourceFile): string {
  const name = decl.name.getText(sf);
  if (decl.type) return `const ${name}: ${decl.type.getText(sf)}`;
  if (
    decl.initializer &&
    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
  ) {
    const tp = decl.initializer.typeParameters
      ? `<${decl.initializer.typeParameters.map((p) => p.getText(sf)).join(", ")}>`
      : "";
    const params = decl.initializer.parameters.map((p) => p.getText(sf)).join(", ");
    const ret = decl.initializer.type ? decl.initializer.type.getText(sf) : "implicit";
    return `const ${name}: ${tp}(${params}) => ${ret}`;
  }
  if (
    decl.initializer &&
    (ts.isStringLiteral(decl.initializer) ||
      ts.isNumericLiteral(decl.initializer) ||
      decl.initializer.kind === ts.SyntaxKind.TrueKeyword ||
      decl.initializer.kind === ts.SyntaxKind.FalseKeyword)
  ) {
    return `const ${name} = ${decl.initializer.getText(sf)}`;
  }
  return `const ${name}: inferred`;
}

function extractExportedSymbols(sf: ts.SourceFile): Map<string, ExportedSymbolInfo> {
  const exportsMap = new Map<string, ExportedSymbolInfo>();
  const localDecls = new Map<string, { kind: string; signature: string }>();

  for (const stmt of sf.statements) {
    const info = extractNodeSig(stmt, sf);
    if (info) {
      const prev = localDecls.get(info.name);
      localDecls.set(info.name, {
        kind: info.kind,
        signature: prev ? `${prev.signature}; ${info.signature}` : info.signature,
      });
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        localDecls.set(d.name.getText(sf), { kind: "variable", signature: extractVarSig(d, sf) });
      }
    }
  }

  for (const stmt of sf.statements) {
    if (hasExportModifier(stmt)) {
      const info = extractNodeSig(stmt, sf);
      if (info) {
        const prev = exportsMap.get(info.name);
        exportsMap.set(info.name, {
          name: info.name,
          kind: info.kind,
          signature: prev ? `${prev.signature}; ${info.signature}` : info.signature,
        });
      } else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          const name = d.name.getText(sf);
          exportsMap.set(name, { name, kind: "const", signature: extractVarSig(d, sf) });
        }
      }
    } else if (ts.isExportDeclaration(stmt)) {
      if (stmt.moduleSpecifier) {
        const mod = stmt.moduleSpecifier.getText(sf);
        if (!stmt.exportClause) {
          exportsMap.set(`* from ${mod}`, {
            name: `* from ${mod}`,
            kind: "barrel",
            signature: `export * from ${mod}`,
          });
        } else if (ts.isNamespaceExport(stmt.exportClause)) {
          const name = stmt.exportClause.name.text;
          exportsMap.set(name, {
            name,
            kind: "barrel_namespace",
            signature: `export * as ${name} from ${mod}`,
          });
        } else if (ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            const name = el.name.text;
            const orig = el.propertyName?.text ?? name;
            const isType = el.isTypeOnly || stmt.isTypeOnly;
            exportsMap.set(name, {
              name,
              kind: "reexport",
              signature: `export ${isType ? "type " : ""}{ ${orig === name ? name : `${orig} as ${name}`} } from ${mod}`,
            });
          }
        }
      } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const name = el.name.text;
          const orig = el.propertyName?.text ?? name;
          const local = localDecls.get(orig);
          exportsMap.set(name, {
            name,
            kind: local?.kind ?? "export",
            signature: local
              ? local.signature
              : `export { ${orig === name ? name : `${orig} as ${name}`} }`,
          });
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      exportsMap.set("default", {
        name: "default",
        kind: "default",
        signature: `export default ${stmt.expression.getText(sf)}`,
      });
    }
  }
  return exportsMap;
}

function findDoubleCastEvasions(sf: ts.SourceFile): string[] {
  const evasions: string[] = [];
  function unwrap(node: ts.Node): ts.Node {
    let curr = node;
    while (ts.isParenthesizedExpression(curr)) curr = curr.expression;
    return curr;
  }
  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const inner = unwrap(node.expression);
      if (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) {
        const innerTypeText = inner.type.getText(sf).trim();
        if (innerTypeText === "unknown" || innerTypeText === "any") {
          evasions.push(node.getText(sf));
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return evasions;
}

export function checkAstInvariants(
  preContent: string,
  postContent: string,
  options?: CheckAstOptions,
): CheckAstResult {
  const preSf = ts.createSourceFile("pre.ts", preContent, ts.ScriptTarget.Latest, true);
  const postSf = ts.createSourceFile("post.ts", postContent, ts.ScriptTarget.Latest, true);
  const breaches: AstInvariantBreach[] = [];

  const evasionSnippets = findDoubleCastEvasions(postSf);
  for (const snippet of evasionSnippets) {
    breaches.push({
      code: "TYPE_SAFETY_EVASION_BREACH",
      message: `Type safety evasion double-cast detected: "${snippet}" (TYPE_SAFETY_EVASION_BREACH)`,
      actual: snippet,
    });
  }

  const preMap = extractExportedSymbols(preSf);
  const postMap = extractExportedSymbols(postSf);
  const preExports = Array.from(preMap.values());
  const postExports = Array.from(postMap.values());
  const addedSymbols: string[] = [];
  const removedSymbols: string[] = [];
  const mutatedSymbols: string[] = [];

  for (const [name, postSym] of postMap.entries()) {
    if (!preMap.has(name)) {
      addedSymbols.push(name);
      breaches.push({
        code: "FEATURE_INVENTION_BLUNDER",
        message: `Public symbol "${name}" was added (FEATURE_INVENTION_BLUNDER / PUBLIC_API_EXPANSION)`,
        symbol: name,
        actual: postSym.signature,
      });
    }
  }

  for (const [name, preSym] of preMap.entries()) {
    if (!postMap.has(name)) {
      removedSymbols.push(name);
      breaches.push({
        code: "PUBLIC_API_EXPANSION",
        message: `Public symbol "${name}" was removed (PUBLIC_API_EXPANSION / FEATURE_INVENTION_BLUNDER)`,
        symbol: name,
        expected: preSym.signature,
      });
    }
  }

  for (const [name, preSym] of preMap.entries()) {
    const postSym = postMap.get(name);
    if (!postSym) continue;
    if (normalizeSignature(preSym.signature) !== normalizeSignature(postSym.signature)) {
      mutatedSymbols.push(name);
      breaches.push({
        code: "SIGNATURE_MUTATION_BREACH",
        message: `Signature mutated for "${name}": expected "${preSym.signature}", got "${postSym.signature}" (SIGNATURE_MUTATION_BREACH)`,
        symbol: name,
        expected: preSym.signature,
        actual: postSym.signature,
      });
    }
  }

  const valid = breaches.length === 0;
  const summary = valid
    ? `AST invariants satisfied: public API invariant preserved across ${preExports.length} export(s).`
    : `AST invariants violated with ${breaches.length} breach(es): ${breaches.map((b) => `[${b.code}] ${b.message}`).join("; ")}`;

  const result: CheckAstResult = {
    valid,
    passed: valid,
    breaches,
    preExports,
    postExports,
    addedSymbols,
    removedSymbols,
    mutatedSymbols,
    evasionBreaches: evasionSnippets,
    summary,
  };

  if ((options?.strict || options?.throwOnBreach) && !valid) {
    const primary = breaches[0]!;
    throw new AstInvariantError(primary.code, primary.message, breaches);
  }
  return result;
}

function readSourceOrDirect(value: string): string {
  if (!value.includes("\n") && existsSync(value)) {
    try {
      return readFileSync(value, "utf-8");
    } catch {
      return value;
    }
  }
  return value;
}

export async function optimizeCheckAstCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, ["pre", "post", "target", "strict", "json"]);
  const rawPre = textFlag(flags, "pre", false);
  const rawPost = textFlag(flags, "post", false);
  const rawTarget = textFlag(flags, "target", false);
  const strict = boolFlag(flags, "strict");
  const isJson = boolFlag(flags, "json");

  let preContent: string | undefined;
  let postContent: string | undefined;

  if (rawTarget !== undefined) {
    const targetPath = resolve(rawTarget);
    if (!existsSync(targetPath))
      throw new HarnessError("NOT_FOUND", `Target file not found: ${rawTarget}`);
    postContent =
      rawPost !== undefined ? readSourceOrDirect(rawPost) : readFileSync(targetPath, "utf-8");
    if (rawPre !== undefined) {
      preContent = readSourceOrDirect(rawPre);
    } else {
      const gitRes = spawnSync("git", ["show", `HEAD:${rawTarget}`], { encoding: "utf-8" });
      if (gitRes.status === 0 && typeof gitRes.stdout === "string") {
        preContent = gitRes.stdout;
      } else {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Unable to retrieve git pre-mutation content for ${rawTarget}. Provide --pre explicitly.`,
        );
      }
    }
  } else {
    if (rawPre === undefined || rawPost === undefined) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Both --pre and --post are required when --target is not specified.",
      );
    }
    preContent = readSourceOrDirect(rawPre);
    postContent = readSourceOrDirect(rawPost);
  }

  const result = checkAstInvariants(preContent, postContent, { strict });
  if (!result.valid) {
    const primary = result.breaches[0]!;
    throw new AstInvariantError(primary.code, primary.message, result.breaches);
  }

  return {
    valid: true,
    passed: true,
    breaches: [],
    pre_exports: result.preExports,
    post_exports: result.postExports,
    added_symbols: result.addedSymbols,
    removed_symbols: result.removedSymbols,
    mutated_symbols: result.mutatedSymbols,
    evasion_breaches: result.evasionBreaches,
    summary: result.summary,
    ...(isJson ? { json: true } : {}),
  };
}
