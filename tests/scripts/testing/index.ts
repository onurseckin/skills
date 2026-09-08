export { SCRIPTS_TESTING_GUARDRAILS_SUITES } from "./guardrails/index.ts";
export { SCRIPTS_TESTING_PURITY_RATCHET_SUITES } from "./purity-ratchet/index.ts";
export { SCRIPTS_TESTING_SELECTION_SUITES } from "./selection/index.ts";

export const scriptsTestingSuite = [
  "coverage-html",
  "coverage-metrics",
  "test-changed",
  "test-mutex",
  "test-runner",
] as const;
