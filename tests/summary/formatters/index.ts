/**
 * @file index.ts
 * Facade for Summary Formatters test suite.
 */

export {
  cleanupRoots,
  emptyGraph,
  emptyState,
  manifest,
  metrics,
  render,
  task,
  tempRoot,
} from "./markdown-fixtures-core.ts";

export {
  populatedGraph,
  populatedRunRoot,
  populatedState,
} from "./markdown-fixtures-dag.ts";

export const formattersSuite = [
  "checklist-coverage-section",
  "markdown-file-provenance",
  "markdown-formatter-populated",
  "markdown-formatter-topology-capsules",
  "markdown-formatter-topology-waves",
  "markdown-formatter",
  "markdown-step-provenance",
] as const;
