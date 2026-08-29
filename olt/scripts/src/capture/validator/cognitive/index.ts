import type { PillarValidationResult, ValidationContext, ValidationDefect } from "../types.ts";
import { validateCowanChunking } from "./cowan-chunking.ts";
import { validateFittsLaw } from "./fitts-law.ts";
import { validateHickHyman } from "./hick-hyman.ts";
import { validateNormanRecovery } from "./norman-recovery.ts";
import { validateUiStatesFsm } from "./ui-states-fsm.ts";

export { validateCowanChunking } from "./cowan-chunking.ts";

export {
  calculateFittsId,
  validateFittsLaw,
} from "./fitts-law.ts";

export {
  calculateHickHymanEntropy,
  validateHickHyman,
} from "./hick-hyman.ts";

export { validateNormanRecovery } from "./norman-recovery.ts";

export { validateUiStatesFsm } from "./ui-states-fsm.ts";

export {
  COGNITIVE_BOILERPLATE,
  evaluateCognitiveQuestions,
  validateCognitiveSemanticDepth,
  type CognitiveSemanticDepthDefect,
  type CognitiveSemanticDepthResult,
  type QuestionEvaluatorParams,
} from "./cognitive-questions.ts";

export function validateCognitive(ctx: ValidationContext): PillarValidationResult {
  const defects: ValidationDefect[] = [];
  const elements = ctx.elements;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!el) continue;

    // 1. Cowan 4±1 Working Memory Chunking
    const cowanDefect = validateCowanChunking(el, i);
    if (cowanDefect) defects.push(cowanDefect);

    // 2. Fitts's Law Index of Difficulty
    const fittsDefect = validateFittsLaw(el, i, ctx.viewportBounds);
    if (fittsDefect) defects.push(fittsDefect);

    // 3. Hick-Hyman Decision Entropy
    const hickDefect = validateHickHyman(el, i);
    if (hickDefect) defects.push(hickDefect);

    // 4. Don Norman Error Recovery Grace Periods
    const normanDefect = validateNormanRecovery(el, i);
    if (normanDefect) defects.push(normanDefect);

    // 5. 5 UI States FSM
    const fsmDefect = validateUiStatesFsm(el, i);
    if (fsmDefect) defects.push(fsmDefect);
  }

  return {
    pillar: "cognitive",
    passed: defects.length === 0,
    defects,
    evaluatedCount: elements.length,
  };
}
