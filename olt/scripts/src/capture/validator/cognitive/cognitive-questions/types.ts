import type { ElementPhysicsSnapshot, ValidationContext } from "../../types.ts";

export interface QuestionEvaluatorParams {
  readonly context: ValidationContext;
  readonly elements: readonly ElementPhysicsSnapshot[];
}

export interface CognitiveSemanticDepthDefect {
  readonly questionId: string;
  readonly category: "boilerplate_observation" | "superficial_evidence" | "missing_metrics";
  readonly message: string;
}

export interface CognitiveSemanticDepthResult {
  readonly passed: boolean;
  readonly evaluatedCount: number;
  readonly deepCount: number;
  readonly superficialCount: number;
  readonly averageScore: number;
  readonly defects: readonly CognitiveSemanticDepthDefect[];
}
