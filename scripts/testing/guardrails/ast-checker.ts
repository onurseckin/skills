/**
 * @file ast-checker.ts
 * In-memory TypeScript AST visitor detecting purity violations in unit tests.
 */

import ts from "typescript";
import type { PurityViolation } from "./types.ts";
import {
  createViolation,
  HEAVY_AST_METHODS,
  PROHIBITED_CP_METHODS,
  PROHIBITED_FS_METHODS,
  PROHIBITED_FS_MODULES,
  PROHIBITED_SUBPROCESS_METHODS,
  REPO_PATH_REGEX,
  VIRTUAL_RECEIVER_REGEX,
} from "./rules-config.ts";
import { checkEmptyBody, checkMockTautologies, checkTrivialAssert } from "./anti-patterns.ts";

function checkImports(
  node: ts.ImportDeclaration,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  if (node.importClause?.isTypeOnly === true || !ts.isStringLiteral(node.moduleSpecifier)) return;
  const mod = node.moduleSpecifier.text;

  if (PROHIBITED_FS_MODULES.has(mod)) {
    const named = node.importClause?.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.every((e) => e.isTypeOnly)) return;
    out.push(
      createViolation(
        node,
        sf,
        file,
        "filesystem",
        "no-physical-fs-import",
        `Prohibited real filesystem import '${mod}'. Unit tests must use VirtualMemoryFS.`,
      ),
    );
  } else if (mod === "node:os" || mod === "os") {
    const named = node.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      const hasTmp = named.elements.some((e) => !e.isTypeOnly && e.name.text === "tmpdir");
      if (hasTmp) {
        out.push(
          createViolation(
            node,
            sf,
            file,
            "filesystem",
            "no-physical-tmpdir-import",
            `Prohibited 'tmpdir' import from '${mod}'. Unit tests must use VirtualMemoryFS.`,
          ),
        );
      }
    }
  }
}

function checkTaggedTemplate(
  node: ts.TaggedTemplateExpression,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  if (
    ts.isPropertyAccessExpression(node.tag) &&
    node.tag.expression.getText(sf) === "Bun" &&
    node.tag.name.text === "$"
  ) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "subprocess",
        "no-unmocked-bun-shell",
        "Unmocked subprocess execution via 'Bun.$'. Unit tests must mock process execution.",
      ),
    );
  }
}

function checkIdentifierCall(
  node: ts.CallExpression,
  fnName: string,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): boolean {
  if (PROHIBITED_FS_METHODS.has(fnName) || fnName === "tmpdir") {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "filesystem",
        "no-physical-fs-call",
        `Prohibited physical filesystem call '${fnName}()'. Unit tests must use VirtualMemoryFS.`,
      ),
    );
    return true;
  }
  if (PROHIBITED_SUBPROCESS_METHODS.has(fnName)) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "subprocess",
        "no-unmocked-subprocess-call",
        `Unmocked subprocess call '${fnName}()'. Unit tests must mock process execution.`,
      ),
    );
    return true;
  }
  if (fnName === "test" || fnName === "it") {
    checkEmptyBody(node, fnName, sf, file, out);
    checkMockTautologies(node, fnName, sf, file, out);
    return true;
  }
  return false;
}

function checkMethodCall(
  node: ts.CallExpression,
  expr: ts.PropertyAccessExpression,
  sf: ts.SourceFile,
  file: string,
  out: PurityViolation[],
): void {
  const method = expr.name.text;
  const receiver = expr.expression.getText(sf);

  if (receiver === "test" || receiver === "it") {
    checkEmptyBody(node, `${receiver}.${method}`, sf, file, out);
    checkMockTautologies(node, `${receiver}.${method}`, sf, file, out);
    return;
  }
  if (receiver === "Bun" && (method === "spawn" || method === "spawnSync" || method === "$")) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "subprocess",
        "no-unmocked-bun-spawn",
        `Unmocked Bun subprocess spawn 'Bun.${method}()'. Unit tests must mock process execution.`,
      ),
    );
    return;
  }
  if (
    PROHIBITED_SUBPROCESS_METHODS.has(method) &&
    /(?:child_process|childProcess|cp)/i.test(receiver)
  ) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "subprocess",
        "no-unmocked-child-process",
        `Unmocked subprocess execution '${receiver}.${method}()'. Unit tests must mock process execution.`,
      ),
    );
    return;
  }
  if ((receiver === "os" || receiver === "node:os") && method === "tmpdir") {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "filesystem",
        "no-physical-tmpdir-call",
        `Prohibited physical filesystem call '${receiver}.${method}()'. Unit tests must use VirtualMemoryFS.`,
      ),
    );
    return;
  }
  if (receiver === "ts") {
    if (HEAVY_AST_METHODS.has(method)) {
      out.push(
        createViolation(
          node,
          sf,
          file,
          "ast_scan",
          "no-heavyweight-ast-in-tests",
          `Heavyweight AST method 'ts.${method}()' detected. Static code analysis belongs in linters or scripts.`,
        ),
      );
      return;
    }
    if (method === "createSourceFile") {
      const firstArg = node.arguments[0];
      const argText = firstArg ? firstArg.getText(sf) : "";
      if (REPO_PATH_REGEX.test(argText)) {
        out.push(
          createViolation(
            node,
            sf,
            file,
            "ast_scan",
            "no-repo-ast-scan",
            `Static AST scan of repository file ${argText} in unit test. Static analysis belongs in linters or scripts.`,
          ),
        );
        return;
      }
    }
  }
  if (PROHIBITED_FS_METHODS.has(method) && !VIRTUAL_RECEIVER_REGEX.test(receiver)) {
    out.push(
      createViolation(
        node,
        sf,
        file,
        "filesystem",
        "no-physical-fs-method",
        `Prohibited physical filesystem call '${receiver}.${method}()'. Unit tests must use VirtualMemoryFS.`,
      ),
    );
    return;
  }
  checkTrivialAssert(node, expr, sf, file, out);
}

export function auditSourceCode(sourceCode: string, filePath: string): PurityViolation[] {
  const sf = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const violations: PurityViolation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      checkImports(node, sf, filePath, violations);
    } else if (ts.isTaggedTemplateExpression(node)) {
      checkTaggedTemplate(node, sf, filePath, violations);
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        checkIdentifierCall(node, node.expression.text, sf, filePath, violations);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        checkMethodCall(node, node.expression, sf, filePath, violations);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}
