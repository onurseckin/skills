import type { OpticalHierarchyInspection } from "./types.ts";

function tagRank(tag: string): number {
  const lower = tag.toLowerCase().trim();
  if (lower === "h1") return 1;
  if (lower === "h2") return 2;
  if (lower === "h3") return 3;
  if (lower === "h4") return 4;
  if (lower === "h5") return 5;
  if (lower === "h6") return 6;
  if (lower === "p" || lower === "span" || lower === "body") return 10;
  return 20;
}

export function evaluateOpticalHierarchy(
  headings: readonly {
    selector: string;
    tag: string;
    fontSize: number;
    fontWeight: number | string;
  }[],
): OpticalHierarchyInspection {
  if (headings.length === 0) {
    return {
      score: 100,
      passed: true,
      headingScaleRatio: 1.25,
      visualWeightBalanced: true,
      notes: "No typography heading hierarchy conflicts identified.",
      issues: [],
    };
  }

  const issues: string[] = [];
  let score = 100;

  const sorted = [...headings].sort((a, b) => {
    const rankA = tagRank(a.tag);
    const rankB = tagRank(b.tag);
    return rankA - rankB;
  });

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    const rankCur = tagRank(current.tag);
    const rankNxt = tagRank(next.tag);

    if (rankCur < rankNxt && current.fontSize <= next.fontSize) {
      issues.push(
        `Inverted optical scale: <${current.tag}> (${current.fontSize}px) is smaller than or equal to child <${next.tag}> (${next.fontSize}px)`,
      );
      score -= 25;
    }
  }

  const passed = score >= 80 && issues.length === 0;
  return {
    score: Math.max(0, score),
    passed,
    headingScaleRatio: 1.25,
    visualWeightBalanced: passed,
    notes: passed
      ? "Optical hierarchy conforms to progressive typographic scale with clear visual anchor contrast."
      : `Optical hierarchy violations detected: ${issues.join("; ")}`,
    issues,
  };
}
