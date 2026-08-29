import { join } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  evaluateAdmissionGates,
  findCommandRecord,
  parseFalsifierArgv,
  readCandidateCommandOutput,
  outputContainsDefect,
  type AdmissionGateVerdict,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../proposals/gates/index.ts";
import type {
  CounterfactualFindingKind,
  IsolatedCounterfactualCandidate,
  CounterfactualFinding,
  CounterfactualEvaluationResult,
  CounterfactualCandidateSelectionOptions,
  CounterfactualReAdmissionSuiteResult,
  ContextIsolationAuditResult,
} from "./types.ts";
import {
  DISALLOWED_NARRATIVE_KEYS,
  parseNowIso,
  createIsolatedCandidate,
  auditCandidateIsolation,
  selectPreviouslyAdmittedCandidates,
} from "./types.ts";
import { evaluateCandidateCounterfactual } from "./simulator.ts";

/**
 * Runs a counterfactual re-admission test suite across previously admitted candidates.
 */
export function runCounterfactualReAdmissionSuite(
  state: Record<string, unknown>,
  context: GateEvaluationContext,
  options: CounterfactualCandidateSelectionOptions & { readonly now?: string | number | Date } = {},
): CounterfactualReAdmissionSuiteResult {
  const evaluatedAt = parseNowIso(options.now);
  const candidates = selectPreviouslyAdmittedCandidates(state, options);

  const results: CounterfactualEvaluationResult[] = [];
  const findings: CounterfactualFinding[] = [];
  let persistentCount = 0;
  let clearedCount = 0;

  for (const candidate of candidates) {
    const evalResult = evaluateCandidateCounterfactual(candidate, context, { now: evaluatedAt });
    results.push(evalResult);

    if (evalResult.finding) {
      findings.push(evalResult.finding);
      clearedCount++;
    } else if (evalResult.defectPersists) {
      persistentCount++;
    }
  }

  return {
    evaluatedAt,
    totalEvaluated: results.length,
    persistentCount,
    clearedCount,
    findingsCount: findings.length,
    findings,
    results,
  };
}

/**
 * Formats counterfactual evaluation suite results into structured Markdown.
 */
export function formatCounterfactualReportMarkdown(
  suiteResult: CounterfactualReAdmissionSuiteResult,
): string {
  const lines: string[] = [
    `### Counterfactual Re-Admission Test Report`,
    `- **Evaluated At**: ${suiteResult.evaluatedAt}`,
    `- **Total Evaluated**: ${suiteResult.totalEvaluated}`,
    `- **Persistent Defects (Confirmed)**: ${suiteResult.persistentCount}`,
    `- **Cleared / Non-Persisting Findings**: ${suiteResult.clearedCount}`,
    "",
  ];

  if (suiteResult.findings.length > 0) {
    lines.push(`#### Findings (${suiteResult.findings.length}):`);
    for (const finding of suiteResult.findings) {
      lines.push(
        `- **[${finding.findingKind.toUpperCase()}]** Candidate \`${finding.candidateId}\`: ${finding.message}`,
      );
    }
    lines.push("");
  } else {
    lines.push(
      `_All ${suiteResult.totalEvaluated} tested candidate(s) confirmed persistent defect validity under fresh isolated evaluation._`,
    );
    lines.push("");
  }

  if (suiteResult.results.length > 0) {
    lines.push(`#### Candidate Summaries:`);
    for (const res of suiteResult.results) {
      const statusIcon = res.admissible ? "PASS" : "FINDING";
      lines.push(
        `- \`${res.candidateId}\` [${res.isolatedCandidate.kind}]: **${statusIcon}** — "${res.isolatedCandidate.statement}"`,
      );
      if (res.finding) {
        lines.push(`  - Reason: ${res.finding.message}`);
      }
    }
  }

  return lines.join("\n");
}
