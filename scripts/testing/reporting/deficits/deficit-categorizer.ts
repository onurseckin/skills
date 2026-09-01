/**
 * Coverage Deficit Heuristic Classifier
 * Categorizes uncovered line segments into error-handling, branching,
 * initialization, or unexercised-logic based on patterns and heuristics.
 */
export type CoverageDeficitCategory =
  | "error-handling"
  | "branching"
  | "initialization"
  | "unexercised-logic";
export type DeficitCategory = CoverageDeficitCategory;

export interface DeficitCategoryClassification {
  readonly category: DeficitCategory;
  readonly reason: string;
  readonly sampleCodeSnippet?: string | undefined;
}

const ERROR_REGEX =
  /\b(catch|throw|Error|reject|onError|HarnessError|HttpError|exception|panic|bail|fail|assert)\b/i;
const BRANCHING_REGEX = /\b(if|else|switch|case|default|guard|break|continue)\b|(\?|\?\?|&&|\|\|)/;
const INIT_REGEX =
  /\b(constructor|init|initialize|setup|createDefault|factory|bootstrap|static)\b/i;
const TOP_DECLARATION_REGEX = /^(export\s+)?(const|let|var|type|interface|enum|import)\b/;
const LOGIC_REGEX = /\b(function|async|await|return|while|for|yield|class|extends|implements)\b/;

/**
 * Returns formatted markdown icon badge for a deficit category.
 */
export function getCategoryBadge(category: DeficitCategory): string {
  switch (category) {
    case "error-handling":
      return "🛡️ error-handling";
    case "branching":
      return "🔀 branching";
    case "initialization":
      return "⚙️ initialization";
    case "unexercised-logic":
      return "🧩 unexercised-logic";
    default:
      return "🧩 unexercised-logic";
  }
}

function extractRelevantLines(
  startLine: number,
  endLine: number,
  sourceCode: string | readonly string[],
): string[] {
  const rawLines =
    typeof sourceCode === "string" ? sourceCode.split(/\r?\n/) : Array.from(sourceCode);

  const relevant: string[] = [];
  for (let l = startLine; l <= endLine; l++) {
    const idx = l - 1;
    if (idx >= 0 && idx < rawLines.length) {
      const text = rawLines[idx];
      if (typeof text === "string" && text.trim().length > 0) {
        relevant.push(text.trim());
      }
    }
  }
  return relevant;
}

/**
 * Categorizes a contiguous uncovered segment using code pattern heuristics or positional rules.
 */
export function classifyDeficitCategory(
  startLine: number,
  endLine: number,
  sourceCode?: string | readonly string[] | undefined,
): DeficitCategoryClassification {
  const lineCount = endLine - startLine + 1;

  if (sourceCode) {
    const relevantLines = extractRelevantLines(startLine, endLine, sourceCode);
    const firstLine = relevantLines[0];
    const sampleCodeSnippet =
      firstLine && firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;

    if (relevantLines.length > 0) {
      let errorHits = 0;
      let branchingHits = 0;
      let initHits = 0;
      let logicHits = 0;

      for (const line of relevantLines) {
        if (ERROR_REGEX.test(line)) errorHits++;
        if (BRANCHING_REGEX.test(line)) branchingHits++;
        if (INIT_REGEX.test(line)) initHits++;
        if (startLine <= 10 && TOP_DECLARATION_REGEX.test(line)) initHits++;
        if (LOGIC_REGEX.test(line)) logicHits++;
      }

      if (
        errorHits > 0 &&
        errorHits >= branchingHits &&
        errorHits >= initHits &&
        errorHits >= logicHits
      ) {
        return {
          category: "error-handling",
          reason: "Error handling, exception throwing, or error rejection path",
          sampleCodeSnippet,
        };
      }

      if (branchingHits > 0 && branchingHits >= initHits && branchingHits >= logicHits) {
        return {
          category: "branching",
          reason: "Conditional branching, guard clause, or switch condition",
          sampleCodeSnippet,
        };
      }

      if (logicHits > 0 && logicHits >= initHits) {
        return {
          category: "unexercised-logic",
          reason: "Unexercised routine logic or algorithmic execution block",
          sampleCodeSnippet,
        };
      }

      if (initHits > 0) {
        return {
          category: "initialization",
          reason: "Module setup, constructor, or default initialization logic",
          sampleCodeSnippet,
        };
      }

      return {
        category: "unexercised-logic",
        reason:
          lineCount >= 4
            ? "Unexercised routine logic or algorithmic execution block"
            : "Unexercised code segment",
        sampleCodeSnippet,
      };
    }
  }

  if (startLine <= 10 && lineCount <= 5) {
    return {
      category: "initialization",
      reason: "Top-of-file declaration or initialization segment",
    };
  }
  if (lineCount <= 2) {
    return {
      category: "branching",
      reason: "Short conditional branch or guard segment",
    };
  }
  return {
    category: "unexercised-logic",
    reason: "Multi-line execution logic block",
  };
}
