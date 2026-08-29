import type {
  CognitiveAnalysisReport,
  EvaluatedCognitiveQuestion,
} from "../../types.ts";
import {
  evaluateErgonomicsQuestions,
  evaluatePerceptionQuestions,
} from "./perception-ergonomics.ts";
import type { QuestionEvaluatorParams } from "./types.ts";
import {
  evaluateResilienceAndJtbdQuestions,
  evaluateTypographyQuestions,
} from "./typography-resilience.ts";

export function evaluateCognitiveQuestions(
  params: QuestionEvaluatorParams,
): CognitiveAnalysisReport {
  const { context, elements } = params;
  const vp = context.viewport;
  const vpBounds = context.viewportBounds ?? {
    width: vp === "mobile" ? 390 : vp === "tablet" ? 768 : vp === "desktop-wide" ? 1920 : 1440,
    height: vp === "mobile" ? 844 : vp === "tablet" ? 1024 : vp === "desktop-wide" ? 1080 : 900,
  };

  // Helper selectors and element filters
  const headings = elements.filter(
    (e) =>
      e.tagName === "H1" ||
      e.tagName === "H2" ||
      e.tagName === "H3" ||
      (e.computedStyles?.fontSize !== undefined && e.computedStyles.fontSize >= 20),
  );
  const interactives = elements.filter((e) => e.interactive === true || e.isTouchTarget === true);
  const textElements = elements.filter(
    (e) => (e.text && e.text.trim().length > 0) || e.tagName === "P" || e.tagName === "SPAN",
  );
  const destructiveElements = elements.filter((e) => e.isDestructive === true);

  const questions: EvaluatedCognitiveQuestion[] = [
    ...evaluatePerceptionQuestions(elements, vp, vpBounds, headings),
    ...evaluateErgonomicsQuestions(elements, vp, vpBounds, interactives),
    ...evaluateTypographyQuestions(elements, textElements, headings),
    ...evaluateResilienceAndJtbdQuestions(elements, vp, interactives, destructiveElements),
  ];

  const passedCount = questions.filter((q) => q.passed).length;
  const summary = `Cognitive questionnaire certified ${passedCount}/${questions.length} heuristics as optimal across perception, ergonomics, typography, resilience, and JTBD alignment.`;

  return {
    summary,
    questionsEvaluated: questions.length,
    questionsPassed: passedCount,
    questions,
  };
}
