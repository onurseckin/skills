export { TASK_GRAPH_SUITES } from "./graph/index.ts";
export { TASK_EVOLUTION_SUITES } from "./evolution/index.ts";
export { TASK_SCANNERS_SUITES } from "./scanners/index.ts";
export { TASK_EXECUTION_SUITES } from "./execution/index.ts";

export const TASK_DOMAINS = ["graph", "evolution", "scanners", "execution"] as const;
