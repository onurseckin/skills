export { calculateBrentMetrics } from "./brent.ts";
export { checkDag } from "./check.ts";
export { healDag } from "./heal.ts";
export { detectCyclesTarjan } from "./scc.ts";
export { auditScopeOverlaps } from "./scope-audit.ts";
export { detectArtificialSerializationEdges } from "./serialization.ts";
export type {
  ArtificialSerializationEdge,
  BrentAnalysisResult,
  DagCheckResult,
  DagEdge,
  DagHealOptions,
  DagHealResult,
  DagTaskNode,
  ScopeOverlapFinding,
  TarjanSccResult,
} from "./types.ts";
