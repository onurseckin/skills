import { existsSync, readFileSync, statSync } from "node:fs";
import ts from "typescript";
import { HarnessError } from "../../core/errors/index.ts";
import { ALL_RULES } from "../rules/index.ts";
import { formatAstLintReport } from "./formatters.ts";
import {
  ALL_AST_LINT_RULES,
  createEmptyRuleSummary,
  DEFAULT_PROHIBITED_VENDORS,
  isJsFile,
  isJsxFile,
  type AstLintOptions,
  type AstLintResult,
  type AstLintRule,
  type AstLintViolation,
  type RuleContext,
} from "./index.ts";
import { lintDirectory } from "./scanner.ts";

export function lintSourceCode(
  sourceCode: string,
  filePath?: string,
  options?: AstLintOptions,
): AstLintResult {
  const fileName = typeof filePath === "string" && filePath.length > 0 ? filePath : "source.ts";

  let enabledRulesSet: Set<AstLintRule>;
  if (options !== undefined && options !== null && options.enabledRules !== undefined) {
    enabledRulesSet = new Set(options.enabledRules);
  } else {
    enabledRulesSet = new Set(ALL_AST_LINT_RULES);
  }

  if (options !== undefined && options !== null && options.disabledRules !== undefined) {
    for (const disabled of options.disabledRules) {
      enabledRulesSet.delete(disabled);
    }
  }

  let vendorList: readonly string[] = DEFAULT_PROHIBITED_VENDORS;
  if (options !== undefined && options !== null) {
    if (options.vendorNames !== undefined && options.vendorNames !== null) {
      vendorList = options.vendorNames;
    }
  }
  const vendorSet = new Set<string>(vendorList.map((item) => item.toLowerCase()));

  let scriptKind = ts.ScriptKind.TS;
  if (isJsxFile(fileName)) {
    scriptKind = ts.ScriptKind.TSX;
  } else if (isJsFile(fileName)) {
    scriptKind = ts.ScriptKind.JS;
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const violations: AstLintViolation[] = [];
  const context: RuleContext = {
    sourceFile,
    fileName,
    enabledRulesSet,
    vendorSet,
    violations,
  };

  for (const ruleModule of ALL_RULES) {
    if (enabledRulesSet.has(ruleModule.rule) && ruleModule.checkSourceFile !== undefined) {
      ruleModule.checkSourceFile(sourceCode, context);
    }
  }

  const activeNodeRules = ALL_RULES.filter(
    (r) => enabledRulesSet.has(r.rule) && r.checkNode !== undefined,
  );

  if (activeNodeRules.length > 0) {
    function walk(node: ts.Node): void {
      for (const ruleModule of activeNodeRules) {
        if (ruleModule.checkNode !== undefined) {
          ruleModule.checkNode(node, context);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sourceFile);
  }

  const summaryByRule = createEmptyRuleSummary();
  for (const violation of violations) {
    const prev = summaryByRule[violation.rule];
    summaryByRule[violation.rule] = prev + 1;
  }

  const passed = violations.length === 0;

  return {
    valid: passed,
    passed,
    filePath: fileName,
    violations,
    totalViolations: violations.length,
    summaryByRule,
  };
}

export function lintFile(filePath: string, options?: AstLintOptions): AstLintResult {
  if (!existsSync(filePath)) {
    throw new HarnessError("PATH_SAFETY", `Target file does not exist: ${filePath}`, [
      { filePath },
    ]);
  }
  const content = readFileSync(filePath, "utf-8");
  return lintSourceCode(content, filePath, options);
}

export function assertZeroFallbackCompliance(
  filePathOrSource: string,
  options?: AstLintOptions,
): void {
  let result: AstLintResult;

  if (typeof filePathOrSource === "string" && existsSync(filePathOrSource)) {
    const stat = statSync(filePathOrSource);
    if (stat.isDirectory()) {
      const dirResult = lintDirectory(filePathOrSource, options);
      if (!dirResult.valid) {
        const report = formatAstLintReport(dirResult);
        throw new HarnessError(
          "INTEGRITY",
          `Zero-fallback compliance check failed for directory '${filePathOrSource}' with ${dirResult.totalViolations} violations:\n${report}`,
          [{ directory: filePathOrSource, totalViolations: dirResult.totalViolations }],
        );
      }
      return;
    }
    result = lintFile(filePathOrSource, options);
  } else {
    result = lintSourceCode(filePathOrSource, "anonymous.ts", options);
  }

  if (!result.valid) {
    const report = formatAstLintReport(result);
    throw new HarnessError(
      "INTEGRITY",
      `Zero-fallback compliance check failed for '${result.filePath}' with ${result.totalViolations} violations:\n${report}`,
      [{ file: result.filePath, totalViolations: result.totalViolations }],
    );
  }
}
