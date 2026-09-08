/**
 * @file rules-config.ts
 * Prohibited modules, methods, regex patterns, and violation factory helpers.
 */

import ts from "typescript";
import type { PurityViolation, PurityViolationCategory } from "./types.ts";

export const PROHIBITED_FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);

export const PROHIBITED_FS_METHODS = new Set([
  "writeFileSync",
  "readFileSync",
  "mkdirSync",
  "rmSync",
  "rmdirSync",
  "unlinkSync",
  "appendFileSync",
  "truncateSync",
  "openSync",
  "copyFileSync",
  "readdirSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "accessSync",
  "mkdtempSync",
  "writeFile",
  "readFile",
  "mkdir",
  "rm",
  "unlink",
  "appendFile",
  "truncate",
  "open",
  "copyFile",
  "readdir",
  "stat",
  "lstat",
  "access",
  "mkdtemp",
]);

export const PROHIBITED_SUBPROCESS_METHODS = new Set([
  "execSync",
  "spawnSync",
  "execFileSync",
  "fork",
  "execFile",
  "exec",
  "spawn",
]);

export const PROHIBITED_CP_METHODS = PROHIBITED_SUBPROCESS_METHODS;

export const HEAVY_AST_METHODS = new Set([
  "createProgram",
  "createLanguageService",
  "readConfigFile",
]);

export const VIRTUAL_RECEIVER_REGEX =
  /(?:vfs|virtual|memory|mem|mock|fake|stub|fixture|adapter|session|store)/i;

export const REPO_PATH_REGEX = /(?:^|["'`/])(?:src|scripts|olt|tests|packages)\/[^"'`\s]+/i;

export function getLineCol(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { line: number; column: number } {
  const loc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: loc.line + 1, column: loc.character + 1 };
}

export function createViolation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  category: PurityViolationCategory,
  rule: string,
  message: string,
): PurityViolation {
  const { line, column } = getLineCol(node, sourceFile);
  return {
    file: filePath,
    line,
    column,
    category,
    rule,
    message,
    snippet: node.getText(sourceFile),
  };
}

export const WALL_CLOCK_IDENTIFIERS = new Set([
  "now",
  "elapsed",
  "duration",
  "latencyMs",
  "delta",
  "elapsedMs",
  "durationMs",
  "latency",
  "deltaMs",
]);

export const UNMOCKED_TIMER_IDENTIFIERS = new Set([
  "wakes",
  "receivedWakes",
  "pollWakes",
  "wakeCount",
  "timerCount",
  "tickCount",
]);

export const WALL_CLOCK_COMPARISON_METHODS = new Set([
  "toBeLessThan",
  "toBeGreaterThan",
  "toBeLessThanOrEqual",
  "toBeGreaterThanOrEqual",
]);

export const CHAI_ASSERT_COMPARISONS = new Set([
  "isBelow",
  "isAbove",
  "isAtLeast",
  "isAtMost",
  "lessThan",
  "greaterThan",
]);

export const WALL_CLOCK_RULE = "no-wall-clock-assertion";

export const WALL_CLOCK_VIOLATION_MESSAGE =
  "Wall-clock timing comparison detected in test. Tests must assert deterministic observable state instead of wall-clock latency.";

export function unwrapParens(node: ts.Node): ts.Node {
  let curr = node;
  while (ts.isParenthesizedExpression(curr)) {
    curr = curr.expression;
  }
  return curr;
}

export function findDeclarationInitializer(
  identName: string,
  fromNode: ts.Node,
): ts.Expression | undefined {
  let curr: ts.Node | undefined = fromNode.parent;
  while (curr) {
    if (ts.isBlock(curr) || ts.isSourceFile(curr)) {
      for (const stmt of curr.statements) {
        if (stmt.pos >= fromNode.pos) break;
        if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name) && decl.name.text === identName) {
              if (decl.initializer) return decl.initializer;
            }
          }
        }
      }
    }
    curr = curr.parent;
  }
  return undefined;
}

export function hasFakeTimers(sf: ts.SourceFile, node?: ts.Node): boolean {
  let fileHasHook = false;
  function checkTop(n: ts.Node): void {
    if (fileHasHook) return;
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (
        (ts.isPropertyAccessExpression(expr) && expr.name.text === "useFakeTimers") ||
        (ts.isIdentifier(expr) && expr.text === "useFakeTimers")
      ) {
        fileHasHook = true;
        return;
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "test" || n.expression.text === "it")
    ) {
      return;
    }
    ts.forEachChild(n, checkTop);
  }
  checkTop(sf);
  if (fileHasHook) return true;

  if (node) {
    let curr: ts.Node | undefined = node;
    while (curr) {
      if (
        ts.isCallExpression(curr) &&
        ts.isIdentifier(curr.expression) &&
        (curr.expression.text === "test" || curr.expression.text === "it")
      ) {
        let testHasFake = false;
        function checkTest(n: ts.Node): void {
          if (testHasFake) return;
          if (ts.isCallExpression(n)) {
            const expr = n.expression;
            if (
              (ts.isPropertyAccessExpression(expr) && expr.name.text === "useFakeTimers") ||
              (ts.isIdentifier(expr) && expr.text === "useFakeTimers")
            ) {
              testHasFake = true;
              return;
            }
          }
          ts.forEachChild(n, checkTest);
        }
        checkTest(curr);
        return testHasFake;
      }
      curr = curr.parent;
    }
  }

  return false;
}
