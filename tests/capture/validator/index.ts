/**
 * @file index.ts
 * Facade for Cognitive, Custom Rule, and Synthesis Validator test suites
 */

export const CAPTURE_VALIDATOR_SUITES = [
  "validator-engines",
  "cognitive-chunking-fitts",
  "cognitive-hick-norman",
  "cognitive-fsm-semantic",
  "cognitive-questions",
  "custom-rules-parser",
  "custom-rules-evaluator",
  "custom-rules-synthesis",
  "synthesis-engine",
] as const;
