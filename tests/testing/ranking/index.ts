export { TESTING_RANKING_HTML_SUITES } from "./html/index.ts";
export { createSampleRuntimeSummary } from "./fixture.ts";

export const RANKING_SUITES = [
  "runtime-ranking",
  "coverage-reporting",
  "coverage-gate",
  "deficit-clustering",
  "test-changed",
  "unified-dashboard",
  "deeplinks",
] as const;
