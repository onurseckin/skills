import type {
  ContainerHierarchyEvaluation,
  HierarchyElementInput,
  OpticalHierarchyInspection,
} from "./types.ts";

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

export function normalizeWeightMultiplier(fontWeight: number | string): number {
  if (typeof fontWeight === "number") {
    if (fontWeight <= 200) return 0.75;
    if (fontWeight <= 300) return 0.85;
    if (fontWeight <= 400) return 1.0;
    if (fontWeight <= 500) return 1.08;
    if (fontWeight <= 600) return 1.15;
    if (fontWeight <= 700) return 1.25;
    return 1.35;
  }

  const normalized = String(fontWeight).toLowerCase().trim();
  if (normalized === "light" || normalized === "lighter") return 0.85;
  if (normalized === "normal" || normalized === "regular") return 1.0;
  if (normalized === "medium") return 1.08;
  if (normalized === "semibold" || normalized === "semi-bold") return 1.15;
  if (normalized === "bold") return 1.25;
  if (normalized === "bolder" || normalized === "black" || normalized === "heavy") return 1.35;

  const parsed = parseInt(normalized, 10);
  if (!Number.isNaN(parsed)) {
    return normalizeWeightMultiplier(parsed);
  }
  return 1.0;
}

export function calculateOpticalWeight(element: HierarchyElementInput): number {
  const multiplier = normalizeWeightMultiplier(element.fontWeight);
  const trackingOffset = element.letterSpacing !== undefined ? element.letterSpacing * 0.1 : 0;
  return element.fontSize * multiplier + trackingOffset;
}

export function evaluateOpticalHierarchy(
  headings: readonly HierarchyElementInput[],
): OpticalHierarchyInspection {
  if (headings.length === 0) {
    return {
      score: 100,
      passed: true,
      headingScaleRatio: 1.25,
      visualWeightBalanced: true,
      containerEvaluations: [],
      notes: "No typography heading hierarchy conflicts identified.",
      issues: [],
    };
  }

  // Group headings by container selector (e.g. section, article, nav, aside, dialog, or root)
  const containerGroups = new Map<string, HierarchyElementInput[]>();
  for (const h of headings) {
    const container = h.containerSelector?.trim() || "root";
    const group = containerGroups.get(container) ?? [];
    group.push(h);
    containerGroups.set(container, group);
  }

  const issues: string[] = [];
  const containerEvaluations: ContainerHierarchyEvaluation[] = [];
  let score = 100;

  for (const [container, elements] of containerGroups.entries()) {
    const containerIssues: string[] = [];
    const sorted = [...elements].sort((a, b) => tagRank(a.tag) - tagRank(b.tag));

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      const rankCur = tagRank(current.tag);
      const rankNxt = tagRank(next.tag);

      if (rankCur < rankNxt) {
        const weightCur = calculateOpticalWeight(current);
        const weightNxt = calculateOpticalWeight(next);

        // Inverted hierarchy: parent has lower/equal optical weight, or strictly smaller font size without superior weight
        const isInverted =
          weightCur <= weightNxt ||
          (current.fontSize < next.fontSize && weightCur <= weightNxt * 1.05);

        if (isInverted) {
          const containerPrefix = container !== "root" ? ` in container [${container}]` : "";
          const issue = `Inverted optical scale${containerPrefix}: <${current.tag}> (${current.fontSize}px, weight ${current.fontWeight}, optical weight ${weightCur.toFixed(1)}) is smaller than or equal to child <${next.tag}> (${next.fontSize}px, weight ${next.fontWeight}, optical weight ${weightNxt.toFixed(1)})`;
          issues.push(issue);
          containerIssues.push(issue);
          score -= 25;
        }
      }
    }

    containerEvaluations.push({
      container,
      passed: containerIssues.length === 0,
      issues: containerIssues,
    });
  }

  const passed = score >= 80 && issues.length === 0;
  return {
    score: Math.max(0, score),
    passed,
    headingScaleRatio: 1.25,
    visualWeightBalanced: passed,
    containerEvaluations,
    notes: passed
      ? "Optical hierarchy conforms to progressive typographic scale with clear visual anchor contrast."
      : `Optical hierarchy violations detected: ${issues.join("; ")}`,
    issues,
  };
}
