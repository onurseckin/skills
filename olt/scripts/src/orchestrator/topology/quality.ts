import { HarnessError } from "../../core/errors/index.ts";
import type { DominatingSkillQualityReport } from "./types.ts";

const ANY_REGEXES: readonly RegExp[] = [
  /:\s*any\b/g,
  /as\s+any\b/g,
  /<\s*any\s*>/g,
  /\bArray<\s*any\s*>/g,
  /\bPromise<\s*any\s*>/g,
  /\bRecord<\s*string\s*,\s*any\s*>/g,
  /\bRecord<\s*any\s*,/g,
  /\bany\[\]/g,
];

const SUPPRESSION_REGEXES: readonly RegExp[] = [
  /@ts-ignore/g,
  /@ts-expect-error/g,
  /@ts-nocheck/g,
  /eslint-disable/g,
  /biome-ignore/g,
  /\/\*\s*istanbul\s+ignore/g,
  /\/\*\s*c8\s+ignore/g,
];

export function assertDominatingSkillQuality(options: {
  readonly skills?: readonly string[] | undefined;
  readonly codeSnippets?:
    | readonly { readonly path: string; readonly content: string }[]
    | undefined;
  readonly qualityThreshold?: number | undefined;
  readonly strict?: boolean | undefined;
}): DominatingSkillQualityReport {
  const threshold = typeof options.qualityThreshold === "number" ? options.qualityThreshold : 0.8;
  const strict =
    options.strict !== undefined && typeof options.strict === "boolean" ? options.strict : false;
  const snippets = options.codeSnippets !== undefined ? options.codeSnippets : [];
  const issues: string[] = [];

  let anyTypeCount = 0;
  let suppressionCount = 0;
  let totalLines = 0;
  let typedConstructCount = 0;
  let structuredErrorCount = 0;
  let genericThrowCount = 0;

  for (const snippet of snippets) {
    const lines = snippet.content.split("\n");
    totalLines += lines.length;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      for (const rx of ANY_REGEXES) {
        const matches = line.match(rx);
        if (matches && matches.length > 0) {
          anyTypeCount += matches.length;
          issues.push(`Forbidden 'any' type in ${snippet.path}:${lineNum} - "${line.trim()}"`);
        }
      }

      for (const rx of SUPPRESSION_REGEXES) {
        const matches = line.match(rx);
        if (matches && matches.length > 0) {
          suppressionCount += matches.length;
          issues.push(
            `Forbidden suppression comment in ${snippet.path}:${lineNum} - "${line.trim()}"`,
          );
        }
      }

      if (/new\s+HarnessError\b/.test(line) || /throw\s+new\s+HarnessError\b/.test(line)) {
        structuredErrorCount += 1;
      } else if (/throw\s+["'`]/.test(line) || /throw\s+new\s+Error\b/.test(line)) {
        genericThrowCount += 1;
        issues.push(
          `Unstructured error thrown in ${snippet.path}:${lineNum} - use HarnessError instead`,
        );
      }

      if (
        /interface\s+\w+|type\s+\w+\s*=|function\s+\w+\s*\(|:\s*(string|number|boolean|readonly)/.test(
          line,
        )
      ) {
        typedConstructCount += 1;
      }
    }
  }

  const typeCoverageScore = anyTypeCount === 0 ? 1.0 : Math.max(0, 1.0 - anyTypeCount * 0.25);
  const suppressionScore =
    suppressionCount === 0 ? 1.0 : Math.max(0, 1.0 - suppressionCount * 0.35);
  const errorHandlingScore =
    genericThrowCount === 0
      ? 1.0
      : structuredErrorCount / (structuredErrorCount + genericThrowCount);
  const modularityScore = 1.0;

  let score: number;
  if (anyTypeCount === 0 && suppressionCount === 0 && genericThrowCount === 0) {
    score = 1.0;
  } else {
    score =
      typeCoverageScore * 0.4 +
      suppressionScore * 0.3 +
      errorHandlingScore * 0.2 +
      modularityScore * 0.1;
    score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }

  const passed = anyTypeCount === 0 && suppressionCount === 0 && score >= threshold;

  if (!passed && strict) {
    throw new HarnessError(
      "INTEGRITY",
      `Dominating skill quality assertion failed (score: ${score}, threshold: ${threshold}): ${issues.join("; ")}`,
      issues,
    );
  }

  return {
    passed,
    score,
    metrics: {
      anyTypeCount,
      suppressionCount,
      typeCoverageScore,
      errorHandlingScore,
      modularityScore,
    },
    issues,
  };
}
