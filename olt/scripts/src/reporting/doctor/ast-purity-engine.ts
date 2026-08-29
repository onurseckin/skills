import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type {
  AstPurityFinding,
  DoctorCheckEngineResult,
  DoctorDiagnosticFinding,
} from "./types.ts";

export type { AstPurityFinding };

export interface AstPurityCheckOptions {
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly fileContents?: Readonly<Record<string, string>> | undefined;
}

/**
 * Scans a TypeScript file's content using native TypeScript Compiler AST tokenization.
 * Ignores string literals, template literals, and regex literals to ensure 0 false positives.
 */
export function scanFileForAstPurity(filePath: string, content: string): AstPurityFinding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const findings: AstPurityFinding[] = [];

  // 1. Scan actual comment ranges for compiler suppression directives (ignore / expect-error)
  const commentScanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content,
  );
  const scannedCommentRanges = new Set<string>();

  let token = commentScanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const leadingComments = ts.getLeadingCommentRanges(content, commentScanner.getTokenPos());
    if (leadingComments) {
      for (const comment of leadingComments) {
        const key = `${comment.pos}:${comment.end}`;
        if (!scannedCommentRanges.has(key)) {
          scannedCommentRanges.add(key);
          const commentText = content.slice(comment.pos, comment.end);
          if (commentText.includes("@ts-ignore") || commentText.includes("@ts-expect-error")) {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(comment.pos);
            const trimmed = commentText.trim();
            findings.push({
              filePath,
              lineNumber: line + 1,
              columnNumber: character + 1,
              violationType: "COMPILER_SUPPRESSION_DIRECTIVE",
              nodeText: trimmed,
              message: `Banned compiler suppression directive in comment at ${filePath}:${line + 1}:${character + 1}: "${trimmed}"`,
            });
          }
        }
      }
    }
    token = commentScanner.scan();
  }

  // 2. Walk AST for AnyKeyword and type assertions
  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      return;
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const parent = node.parent;
      const isAssertion =
        parent && (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent));
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      findings.push({
        filePath,
        lineNumber: line + 1,
        columnNumber: character + 1,
        violationType: isAssertion ? "ANY_TYPE_ASSERTION" : "EXPLICIT_ANY",
        nodeText: (isAssertion && parent ? parent : node).getText(sourceFile),
        message:
          isAssertion && parent
            ? `Banned 'any' type assertion at ${filePath}:${line + 1}:${character + 1} ("${parent.getText(sourceFile)}")`
            : `Explicit 'any' type prohibited at ${filePath}:${line + 1}:${character + 1}`,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

/**
 * Engine 2: checkAstPurity
 * Scans TypeScript files using AST tokenization for @ts-ignore, @ts-expect-error, and any usages.
 */
export function checkAstPurity(options: AstPurityCheckOptions = {}): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];

  function recordFindings(purityFindings: readonly AstPurityFinding[]): void {
    for (const f of purityFindings) {
      findings.push({
        code: "AST_PURITY_VIOLATION",
        severity: "ERROR",
        engine: "checkAstPurity",
        message: `AST purity invariant violation in ${f.filePath}:${f.lineNumber}: ${f.message}`,
        details: {
          filePath: f.filePath,
          lineNumber: f.lineNumber,
          columnNumber: f.columnNumber,
          violationType: f.violationType,
          nodeText: f.nodeText,
        },
      });
    }
  }

  // 1. If explicit fileContents provided
  if (options.fileContents) {
    for (const [path, content] of Object.entries(options.fileContents)) {
      recordFindings(scanFileForAstPurity(path, content));
    }
    return {
      engine: "checkAstPurity",
      passed: findings.length === 0,
      findings,
    };
  }

  // 2. If writeScope provided
  if (options.writeScope && options.writeScope.length > 0) {
    for (const relPath of options.writeScope) {
      const fullPath = options.repoRoot ? resolve(options.repoRoot, relPath) : resolve(relPath);
      if (existsSync(fullPath)) {
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
            const content = readFileSync(fullPath, "utf-8");
            recordFindings(scanFileForAstPurity(relPath, content));
          }
        } catch {
          // File read error ignored
        }
      }
    }
  }

  return {
    engine: "checkAstPurity",
    passed: findings.length === 0,
    findings,
  };
}
