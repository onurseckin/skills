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
