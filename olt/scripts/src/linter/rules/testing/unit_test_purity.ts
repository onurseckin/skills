import ts from "typescript";
import type { AstLintRuleModule, FixSuggestion, RuleContext } from "../../core/index.ts";

const PROHIBITED_FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);

const PROHIBITED_CP_MODULES = new Set(["child_process", "node:child_process"]);

const PROHIBITED_FS_METHODS = new Set([
  "readFileSync",
  "writeFileSync",
  "mkdirSync",
  "rmSync",
  "unlinkSync",
  "appendFileSync",
  "openSync",
  "copyFileSync",
  "readdirSync",
  "truncateSync",
  "existsSync",
  "statSync",
  "lstatSync",
  "accessSync",
  "readFile",
  "writeFile",
  "mkdir",
  "rm",
  "unlink",
  "appendFile",
  "open",
  "copyFile",
  "readdir",
  "truncate",
  "access",
  "stat",
  "lstat",
]);

const PROHIBITED_SUBPROCESS_METHODS = new Set([
  "execSync",
  "spawnSync",
  "execFileSync",
  "fork",
  "execFile",
]);

const PROHIBITED_CP_METHODS = new Set([
  "exec",
  "spawn",
  "execSync",
  "spawnSync",
  "execFile",
  "execFileSync",
  "fork",
]);

const HEAVY_AST_METHODS = new Set(["createProgram", "createLanguageService", "readConfigFile"]);

const VIRTUAL_FS_REGEX = /(?:vfs|virtual|memory|mem|mock|fake|stub|fixture|adapter|session)/iu;

function isTestFileOrContext(context: RuleContext): boolean {
  const norm = context.fileName.replace(/\\/gu, "/");
  if (
    /(?:^|\/)tests[/]/u.test(norm) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(norm) ||
    norm.toLowerCase().includes("test") ||
    norm.toLowerCase().includes("spec")
  ) {
    return true;
  }
  return context.sourceFile.statements.some(
    (stmt) =>
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      (stmt.moduleSpecifier.text === "bun:test" ||
        stmt.moduleSpecifier.text === "vitest" ||
        stmt.moduleSpecifier.text.includes("test")),
  );
}

function addViolation(context: RuleContext, node: ts.Node, message: string): void {
  const loc = context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile));
  context.violations.push({
    rule: "unit_test_purity",
    message,
    file: context.fileName,
    line: loc.line + 1,
    column: loc.character + 1,
    snippet: node.getText(context.sourceFile),
  });
}

function checkModuleSpecifier(
  mod: string,
  kind: "import" | "dynamic" | "require",
  node: ts.Node,
  context: RuleContext,
): void {
  if (PROHIBITED_FS_MODULES.has(mod)) {
    const label =
      kind === "dynamic"
        ? `Real filesystem dynamic import('${mod}')`
        : kind === "require"
          ? `Real filesystem require('${mod}')`
          : `Real filesystem import '${mod}'`;
    addViolation(
      context,
      node,
      `Unit test purity violation: ${label} detected. Unit tests must strictly use 'VirtualMemoryFS' or in-memory fixtures (ZERO_DISK_IO_TESTING_INVARIANT).`,
    );
  } else if (PROHIBITED_CP_MODULES.has(mod)) {
    const label =
      kind === "dynamic"
        ? `Subprocess dynamic import('${mod}')`
        : kind === "require"
          ? `Subprocess require('${mod}')`
          : `Subprocess import '${mod}'`;
    addViolation(
      context,
      node,
      `Unit test purity violation: ${label} detected. Unit tests must strictly mock execution without spawning OS processes.`,
    );
  }
}

export const unitTestPurityRule: AstLintRuleModule = {
  rule: "unit_test_purity",
  checkNode: (node: ts.Node, context: RuleContext) => {
    if (!isTestFileOrContext(context)) return;

    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly === true) return;
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        checkModuleSpecifier(node.moduleSpecifier.text, "import", node, context);
      }
      return;
    }

    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag;
      if (ts.isPropertyAccessExpression(tag)) {
        if (tag.expression.getText(context.sourceFile) === "Bun" && tag.name.text === "$") {
          addViolation(
            context,
            node,
            "Unit test purity violation: Subprocess execution via 'Bun.$' detected. Unit tests must strictly mock execution without spawning OS processes.",
          );
        }
      }
      return;
    }

    if (ts.isCallExpression(node)) {
      const expr = node.expression;

      if (expr.kind === ts.SyntaxKind.ImportKeyword) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          checkModuleSpecifier(firstArg.text, "dynamic", node, context);
        }
        return;
      }

      if (ts.isIdentifier(expr) && expr.text === "require") {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          checkModuleSpecifier(firstArg.text, "require", node, context);
        }
        return;
      }

      if (ts.isIdentifier(expr)) {
        if (PROHIBITED_FS_METHODS.has(expr.text)) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Real filesystem call '${expr.text}()' detected. Unit tests must strictly use 'VirtualMemoryFS' or in-memory fixtures (ZERO_DISK_IO_TESTING_INVARIANT).`,
          );
          return;
        }
        if (PROHIBITED_SUBPROCESS_METHODS.has(expr.text)) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Subprocess execution call '${expr.text}()' detected. Unit tests must strictly mock execution without spawning OS processes.`,
          );
          return;
        }
      }

      if (ts.isPropertyAccessExpression(expr)) {
        const methodName = expr.name.text;
        const receiverText = expr.expression.getText(context.sourceFile);

        if (
          receiverText === "Bun" &&
          (methodName === "spawn" || methodName === "spawnSync" || methodName === "$")
        ) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Bun subprocess execution 'Bun.${methodName}()' detected. Unit tests must strictly mock execution without spawning OS processes.`,
          );
          return;
        }

        if (
          PROHIBITED_CP_METHODS.has(methodName) &&
          /(?:^|\b)(?:child_process|childProcess|cp)(?:\b|$)/iu.test(receiverText)
        ) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Subprocess call '${receiverText}.${methodName}()' detected. Unit tests must strictly mock execution without spawning OS processes.`,
          );
          return;
        }

        if (receiverText === "ts" && HEAVY_AST_METHODS.has(methodName)) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Heavyweight 'ts.${methodName}()' detected in unit test. Static code analysis belongs in task:check, oxlint, or pre-commit hooks, not unit tests.`,
          );
          return;
        }

        if (PROHIBITED_FS_METHODS.has(methodName) && !VIRTUAL_FS_REGEX.test(receiverText)) {
          addViolation(
            context,
            node,
            `Unit test purity violation: Real filesystem method '${receiverText}.${methodName}()' detected. Unit tests must strictly use 'VirtualMemoryFS' or in-memory fixtures (ZERO_DISK_IO_TESTING_INVARIANT).`,
          );
        }
      }
    }
  },

  generateFixSuggestion: (
    violation,
  ): Pick<FixSuggestion, "suggestedReplacement" | "explanation"> => {
    if (violation.message.includes("filesystem") || violation.message.includes("VirtualMemoryFS")) {
      return {
        suggestedReplacement: "/* Use VirtualMemoryFS from 'olt/scripts/src/testing/virtual-fs' */",
        explanation: "Replace real disk filesystem operations with in-memory VirtualMemoryFS.",
      };
    }
    if (violation.message.includes("Subprocess") || violation.message.includes("Bun")) {
      return {
        suggestedReplacement: "/* Use in-memory mock implementation or virtual adapter */",
        explanation: "Replace real subprocess invocations with virtual stubs or mocks.",
      };
    }
    return {
      suggestedReplacement: "/* Move static AST inspection to task:check or pre-commit scripts */",
      explanation:
        "Static AST inspection belongs in task:check, oxlint, or pre-commit hooks, not unit tests.",
    };
  },
};
