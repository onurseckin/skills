/**
 * @file index.ts
 * Facade for Summary DAG Reporter test suite.
 */

export {
  assetUrlCounts,
  makeCommand,
  makeEvent,
  makeGrant,
  makeState,
  makeTask,
} from "./graph-fixtures.ts";

export const dagSuite = [
  "graph-branch-subgraph-capsules",
  "graph-branch-subgraph-isolation",
  "graph-browser-tests",
  "graph-edge-vocabulary",
  "graph-generator",
  "graph-run-facts",
  "graph-topology-and-capsules",
] as const;
