import type { CognitiveAnalysisReport } from "../../types.ts";
import type { CognitiveSemanticDepthDefect, CognitiveSemanticDepthResult } from "./types.ts";

export const COGNITIVE_BOILERPLATE: ReadonlySet<string> = new Set([
  "ok",
  "pass",
  "passed",
  "looks good",
  "n/a",
  "none",
  "true",
  "yes",
  "verified",
  "checked",
  "all good",
  "placeholder",
  "tbd",
  "fine",
  "done",
]);

/**
 * Validates semantic depth of cognitive analysis reports, rejecting superficial observations and unevidenced answers.
 */
export function validateCognitiveSemanticDepth(
  report: CognitiveAnalysisReport,
): CognitiveSemanticDepthResult {
  const defects: CognitiveSemanticDepthDefect[] = [];
  let totalScore = 0;
  let deepCount = 0;
  const questions = report.questions ?? [];

  for (const q of questions) {
    const obs = q.observation?.trim() ?? "";
    const ev = q.evidence?.trim() ?? "";
    let qDefects = 0;

    if (obs.length === 0 || COGNITIVE_BOILERPLATE.has(obs.toLowerCase())) {
      defects.push({
        questionId: q.id,
        category: "boilerplate_observation",
        message: `Question '${q.id}' observation is empty or contains boilerplate: '${obs}'.`,
      });
      qDefects++;
    } else if (obs.length < 15) {
      defects.push({
        questionId: q.id,
        category: "superficial_evidence",
        message: `Question '${q.id}' observation is too brief (< 15 chars) to articulate UX rationale: '${obs}'.`,
      });
      qDefects++;
    }

    if (ev.length === 0 || COGNITIVE_BOILERPLATE.has(ev.toLowerCase())) {
      defects.push({
        questionId: q.id,
        category: "superficial_evidence",
        message: `Question '${q.id}' evidence is empty or contains boilerplate: '${ev}'.`,
      });
      qDefects++;
    }

    const metricMatches = ev.match(/\b\d+(\.\d+)?(px|%|rem|em|ms|s|B|KB|MB|Lc|fps)?\b/gi);
    const metricsCount = metricMatches ? metricMatches.length : 0;
    if (metricsCount === 0 && ev.length < 25) {
      defects.push({
        questionId: q.id,
        category: "missing_metrics",
        message: `Question '${q.id}' evidence lacks empirical quantitative measurements or counts.`,
      });
      qDefects++;
    }

    const score = qDefects === 0 ? 1.0 : qDefects === 1 ? 0.5 : 0.0;
    totalScore += score;
    if (qDefects === 0) {
      deepCount++;
    }
  }

  const evaluatedCount = questions.length;
  const averageScore = evaluatedCount > 0 ? Number((totalScore / evaluatedCount).toFixed(2)) : 0;
  const superficialCount = evaluatedCount - deepCount;
  const passed = defects.length === 0 && evaluatedCount > 0;

  return {
    passed,
    evaluatedCount,
    deepCount,
    superficialCount,
    averageScore,
    defects,
  };
}
