import { resolve } from "node:path";
import { parseCharter } from "../../../lifecycle/charter/index.ts";
import { readTaskQueue } from "../../queue/index.ts";
import { DEFAULT_SOURCE_EXTENSIONS, DEFAULT_EXCLUDE_PATTERNS } from "../types.ts";
import { resolveDiscoveryCharterPath, sanitizeSlug } from "./quality-scanner.ts";
import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../../../../core/errors/index.ts";
import type {
  CognitiveGapFinding,
  CognitiveGapScanOptions,
  CognitiveGapScanResult,
  DormantCriteriaFinding,
  DormantCriteriaScanOptions,
  DormantCriteriaScanResult,
} from "../types.ts";
import { collectFilesRecursively } from "./quality-scanner.ts";

export function scanCognitiveGaps(options: CognitiveGapScanOptions = {}): CognitiveGapScanResult {
  const startTime = Date.now();
  const roots =
    options.sourceRoots && options.sourceRoots.length > 0
      ? options.sourceRoots
      : ["olt/scripts/src"];
  const extensions = options.fileExtensions ? options.fileExtensions : DEFAULT_SOURCE_EXTENSIONS;
  const excludes = options.excludePatterns ? options.excludePatterns : DEFAULT_EXCLUDE_PATTERNS;
  const maxFindings = options.maxFindings ? options.maxFindings : 50;

  const allFiles: string[] = [];
  for (const root of roots) {
    const resolvedRoot = resolve(root);
    collectFilesRecursively(resolvedRoot, resolvedRoot, extensions, excludes, allFiles);
  }

  const findings: CognitiveGapFinding[] = [];

  for (const file of allFiles) {
    if (findings.length >= maxFindings) break;

    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (findings.length >= maxFindings) break;
        const line = lines[i];
        if (!line) continue;
        const lineNum = i + 1;
        const trimmed = line.trim();

        const leadingSpaces = line.search(/\S/);
        if (leadingSpaces >= 20 && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
          findings.push({
            file,
            line: lineNum,
            issueType: "COGNITIVE_COMPLEXITY",
            description: `Excessive nesting depth (${leadingSpaces} spaces) on line ${lineNum}: "${trimmed.slice(0, 50)}"`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation:
              "Extract deeply nested conditionals or loops into focused helper functions.",
          });
        }

        if (
          /function\s+\w+\s*\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/.test(line) ||
          /\(\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^,]+,\s*\w+:[^)]*\)\s*=>/.test(
            line,
          )
        ) {
          findings.push({
            file,
            line: lineNum,
            issueType: "COGNITIVE_CHUNKING_OVERLOAD",
            description: `Function exceeds Cowan/Miller chunking capacity with >5 positional parameters on line ${lineNum}`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation:
              "Consolidate parameters into a structured options interface object.",
          });
        }

        if (
          trimmed.includes("JSON.parse(") &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("/*")
        ) {
          const priorLines = lines.slice(Math.max(0, i - 4), i).join(" ");
          if (
            !priorLines.includes("try {") &&
            !priorLines.includes("try{") &&
            !priorLines.includes("try ")
          ) {
            findings.push({
              file,
              line: lineNum,
              issueType: "UNHANDLED_BOUNDARY",
              description: `Unprotected JSON.parse boundary on line ${lineNum}: "${trimmed.slice(0, 50)}"`,
              snippet: trimmed,
              severity: "HIGH",
              suggestedRemediation:
                "Wrap JSON.parse in try/catch or use a resilient parsing utility.",
            });
          }
        }

        if (
          trimmed.startsWith("while (true)") ||
          trimmed.startsWith("while(true)") ||
          trimmed.startsWith("while (1)")
        ) {
          const bodyLines: string[] = [];
          let depth = 0;
          for (let k = i; k < lines.length; k++) {
            const l = lines[k] ? lines[k]!.trim() : "";
            const openBraces = l.match(/\{/g);
            const closeBraces = l.match(/\}/g);
            if (openBraces) depth += openBraces.length;
            if (closeBraces) depth -= closeBraces.length;
            if (k > i) bodyLines.push(l);
            if (depth <= 0 && k > i) break;
          }
          const body = bodyLines.join(" ");
          if (!body.includes("break") && !body.includes("return") && !body.includes("throw")) {
            findings.push({
              file,
              line: lineNum,
              issueType: "UNBOUNDED_COLLECTION",
              description: `Unbounded while(true) loop lacking explicit termination bound on line ${lineNum}`,
              snippet: trimmed,
              severity: "HIGH",
              suggestedRemediation: "Add bounded loop counter or explicit termination conditions.",
            });
          }
        }

        const isCatchHeader =
          trimmed.startsWith("catch") || trimmed.endsWith("catch {") || trimmed.includes("} catch");
        const nextTrimmed = lines[i + 1] ? lines[i + 1]!.trim() : "";
        const nextNextTrimmed = lines[i + 2] ? lines[i + 2]!.trim() : "";
        const isMultiLineEmptyCatch =
          isCatchHeader &&
          (nextTrimmed === "}" || (nextTrimmed.startsWith("//") && nextNextTrimmed === "}"));

        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(trimmed) || isMultiLineEmptyCatch) {
          findings.push({
            file,
            line: lineNum,
            issueType: "MISSING_ERROR_RECOVERY",
            description: `Empty catch block swallowing errors silently on line ${lineNum}`,
            snippet: trimmed,
            severity: "MEDIUM",
            suggestedRemediation: "Log error, rethrow, or handle with resilient fallback recovery.",
          });
        }
      }
    } catch {}
  }

  return {
    findings,
    filesScanned: allFiles.length,
    totalFindings: findings.length,
    durationMs: Date.now() - startTime,
  };
}

export function scanDormantCriteria(
  options: DormantCriteriaScanOptions = {},
): DormantCriteriaScanResult {
  const startTime = Date.now();
  const charterPath = resolveDiscoveryCharterPath(options.charterPath);
  const maxFindings = options.maxFindings ? options.maxFindings : 20;

  const findings: DormantCriteriaFinding[] = [];
  let goalsCheckedCount = 0;

  if (!existsSync(charterPath)) {
    return {
      findings: [
        {
          criteriaId: "missing-charter",
          source: "charter_goal",
          statement: "Charter document is missing at expected location",
          severity: "CRITICAL",
          suggestedRemediation:
            "Create olt/agents/mind.yaml with valid identity, goals, and repo_roots sections.",
        },
      ],
      goalsCheckedCount: 0,
      dormantCount: 1,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const rawContent = readFileSync(charterPath, "utf8");
    const parsed = parseCharter(rawContent);

    const taskHistory = options.recentTasksHistory
      ? options.recentTasksHistory
      : readTaskQueue(options.taskQueuePath);
    const targetedGoals = new Set<string>();

    for (const task of taskHistory) {
      for (const g of task.charter_goals) {
        targetedGoals.add(g.toUpperCase().trim());
      }
    }

    goalsCheckedCount = parsed.goals.length;

    for (const goal of parsed.goals) {
      if (findings.length >= maxFindings) break;
      const normalizedId = goal.id.toUpperCase().trim();

      if (!targetedGoals.has(normalizedId)) {
        findings.push({
          criteriaId: goal.id,
          source: "charter_goal",
          statement: goal.statement,
          severity: "MEDIUM",
          suggestedRemediation: `Synthesize dedicated task targeting dormant charter goal ${goal.id}: "${goal.statement}"`,
        });
      }
    }

    const stabilityChecks = parsed.stability ? parsed.stability : [];
    for (const check of stabilityChecks) {
      if (findings.length >= maxFindings) break;
      if (!check.command.trim()) {
        findings.push({
          criteriaId: `stability-${sanitizeSlug(check.command)}`,
          source: "charter_stability",
          statement: `Stability check: ${check.command}`,
          severity: "LOW",
          suggestedRemediation: `Ensure automated test verifies exit code ${check.expectedExit} for command "${check.command}"`,
        });
      }
    }
  } catch (err) {
    if (err instanceof HarnessError) {
      findings.push({
        criteriaId: "charter-parse-error",
        source: "charter_goal",
        statement: `Charter validation failed: ${err.message}`,
        severity: "CRITICAL",
        suggestedRemediation:
          "Repair olt/agents/mind.yaml formatting per CONTRACTS.md §7 standards.",
      });
    }
  }

  return {
    findings,
    goalsCheckedCount,
    dormantCount: findings.length,
    durationMs: Date.now() - startTime,
  };
}
