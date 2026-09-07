export { nodesEvidenceSuite } from "./evidence/index.ts";
export { nodesValidationSuite } from "./validation/index.ts";

export const nodesSuite = [
  "graph-asset-completeness",
  "graph-generator-gate-and-ownership-nodes",
  "graph-node-evidence-logs",
  "graph-node-evidence-transitions",
  "graph-plan-validator-nodes",
  "graph-role-projection",
  "graph-role-projection-branches",
  "graph-validator-nodes-core",
  "graph-validator-nodes-rounds",
  "graph-validator-probe-pushback",
] as const;
