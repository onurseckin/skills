import type {
  TokenCompositionDescriptor,
  CompositionEvaluationResult,
  CompositionRecommendation,
} from "./types.ts";

export class CompositionalDialecticEngine {
  /**
   * Evaluate a token composition and recommend systemic elevations
   */
  public evaluateComposition(composition: TokenCompositionDescriptor): CompositionEvaluationResult {
    const recommendations: CompositionRecommendation[] = [];
    let score = 100;

    // Check heading typography pairing
    if (composition.hierarchyLevel === "h1") {
      if (composition.fontSize && !["3xl", "4xl", "5xl"].includes(composition.fontSize)) {
        score -= 20;
        recommendations.push({
          category: "typographic_contrast",
          severity: "warning",
          currentComposition: `fontSize: ${composition.fontSize}`,
          suggestedComposition: "fontSize: 4xl or 5xl",
          rationale:
            "H1 heading hierarchy requires commanding visual dominance (4xl=36px or 5xl=48px).",
        });
      }
      if (composition.lineHeight && ["relaxed", "loose"].includes(composition.lineHeight)) {
        score -= 15;
        recommendations.push({
          category: "typographic_contrast",
          severity: "warning",
          currentComposition: `lineHeight: ${composition.lineHeight}`,
          suggestedComposition: "lineHeight: tight or snug",
          rationale:
            "Large display headings (H1) should use tight (1.25) or snug (1.375) line heights to avoid visual fragmentation.",
        });
      }
    }

    if (composition.hierarchyLevel === "h2") {
      if (composition.fontSize && !["2xl", "3xl"].includes(composition.fontSize)) {
        score -= 15;
        recommendations.push({
          category: "typographic_contrast",
          severity: "info",
          currentComposition: `fontSize: ${composition.fontSize}`,
          suggestedComposition: "fontSize: 2xl or 3xl",
          rationale:
            "H2 section headings achieve optimal scanning rhythm at 2xl (24px) or 3xl (30px).",
        });
      }
    }

    // Check card elevation & spacing rhythm
    if (composition.hierarchyLevel === "card") {
      if (composition.spacingInner && ["none", "3xs", "2xs"].includes(composition.spacingInner)) {
        score -= 25;
        recommendations.push({
          category: "spatial_rhythm",
          severity: "error",
          currentComposition: `spacingInner: ${composition.spacingInner}`,
          suggestedComposition: "spacingInner: md (16px) or lg (24px)",
          rationale:
            "Cards require internal breathing room (md or lg) to prevent content collisions with card borders.",
        });
      }
      if (composition.shadowElevation === "none" && composition.borderRadius === "none") {
        score -= 10;
        recommendations.push({
          category: "elevation",
          severity: "info",
          currentComposition: "shadowElevation: none, borderRadius: none",
          suggestedComposition: "shadowElevation: sm, borderRadius: md",
          rationale:
            "Elevating card containers with subtle shadow (sm) and soft radius (md) reinforces spatial depth.",
        });
      }
    }

    // Check modal elevation
    if (composition.hierarchyLevel === "modal") {
      if (composition.shadowElevation && !["xl", "2xl"].includes(composition.shadowElevation)) {
        score -= 20;
        recommendations.push({
          category: "elevation",
          severity: "warning",
          currentComposition: `shadowElevation: ${composition.shadowElevation}`,
          suggestedComposition: "shadowElevation: xl or 2xl",
          rationale:
            "Modal dialogs represent the top structural z-layer and must cast commanding depth shadows (xl or 2xl).",
        });
      }
    }

    return {
      componentName: composition.componentName,
      harmonized: recommendations.length === 0,
      recommendations,
      elevationScore: Math.max(0, score),
    };
  }
}
