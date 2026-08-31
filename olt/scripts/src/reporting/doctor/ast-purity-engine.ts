import { spawnSync } from "node:child_process";
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

export function scanFileForAstPurity(filePath: string, content: string): AstPurityFinding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const findings: AstPurityFinding[] = [];

  const commentScanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content,
  );
  const scannedCommentRanges = new Set<string>();

  const checkComment = (comment: ts.CommentRange) => {
    const key = `${comment.pos}:${comment.end}`;
    if (!scannedCommentRanges.has(key)) {
      scannedCommentRanges.add(key);
      const commentText = content.slice(comment.pos, comment.end);
      if (
        commentText.includes("@ts-ignore") ||
        commentText.includes("@ts-expect-error") ||
        commentText.includes("@ts-nocheck") ||
        commentText.includes("eslint-disable")
      ) {
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
  };

  let token = commentScanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const leadingComments = ts.getLeadingCommentRanges(content, commentScanner.getTokenPos());
    if (leadingComments) {
      for (const comment of leadingComments) checkComment(comment);
    }
    const trailingComments = ts.getTrailingCommentRanges(content, commentScanner.getTokenPos());
    if (trailingComments) {
      for (const comment of trailingComments) checkComment(comment);
    }
    token = commentScanner.scan();
  }

  const eofLeading = ts.getLeadingCommentRanges(content, commentScanner.getTokenPos());
  if (eofLeading) {
    for (const comment of eofLeading) checkComment(comment);
  }

  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      node.kind === ts.SyntaxKind.RegularExpressionLiteral
    ) {
      return;
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      let curr: ts.Node | undefined = node.parent;
      let enclosingAssertion: ts.AsExpression | ts.TypeAssertion | null = null;
      while (
        curr &&
        !ts.isSourceFile(curr) &&
        !ts.isStatement(curr) &&
        !ts.isFunctionDeclaration(curr) &&
        !ts.isArrowFunction(curr) &&
        !ts.isClassDeclaration(curr) &&
        !ts.isInterfaceDeclaration(curr) &&
        !ts.isTypeAliasDeclaration(curr)
      ) {
        if (ts.isAsExpression(curr) || ts.isTypeAssertionExpression(curr)) {
          enclosingAssertion = curr;
          break;
        }
        curr = curr.parent;
      }

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      findings.push({
        filePath,
        lineNumber: line + 1,
        columnNumber: character + 1,
        violationType: enclosingAssertion ? "ANY_TYPE_ASSERTION" : "EXPLICIT_ANY",
        nodeText: (enclosingAssertion ? enclosingAssertion : node).getText(sourceFile),
        message: enclosingAssertion
          ? `Banned 'any' type assertion at ${filePath}:${line + 1}:${character + 1} ("${enclosingAssertion.getText(sourceFile)}")`
          : `Explicit 'any' type prohibited at ${filePath}:${line + 1}:${character + 1}`,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

export function sanitizeGitPorcelainPath(rawPathEntry: string): string {
  let p = rawPathEntry.trim();
  if (p.includes(" -> ")) {
    const parts = p.split(" -> ");
    p = parts[parts.length - 1]!.trim();
  }
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return p;
}

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

  const targets: string[] = [];
  if (options.writeScope && options.writeScope.length > 0) {
    targets.push(...options.writeScope);
  } else {
    try {
      const cwd = options.repoRoot ? resolve(options.repoRoot) : process.cwd();
      const res = spawnSync("git", ["status", "--porcelain"], {
        cwd,
        encoding: "utf-8",
        timeout: 5000,
      });
      if (res.status === 0 && res.stdout) {
        const lines = res.stdout.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          if (line.length < 3) continue;
          const rawRel = line.slice(3);
          const rel = sanitizeGitPorcelainPath(rawRel);
          if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
            targets.push(rel);
          }
        }
      }
    } catch {}
  }

  const uniqueTargets = Array.from(new Set(targets));
  for (const relPath of uniqueTargets) {
    const fullPath = options.repoRoot ? resolve(options.repoRoot, relPath) : resolve(relPath);
    if (existsSync(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
          const content = readFileSync(fullPath, "utf-8");
          recordFindings(scanFileForAstPurity(relPath, content));
        }
      } catch {}
    }
  }

  return {
    engine: "checkAstPurity",
    passed: findings.length === 0,
    findings,
  };
}
