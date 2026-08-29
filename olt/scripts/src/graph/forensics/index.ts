export { calculateBrentsTheorem } from "./brent-bounds.ts";
export {
  computeCriticalPathDrag,
  computeTaskSlack,
  extractEffort,
  extractEffortById,
  extractNeighbors,
  internalComputeSpan,
} from "./critical-path.ts";
export { breakCycles, findCycles, isAcyclic } from "./cycle-breaking.ts";
export { renderForensicUnicodeReport, renderMermaidDag } from "./forensic-formatter.ts";
export { analyzeQueueStalls, detectArtificialSerialization } from "./queue-stalls.ts";
export type {
  ArtificialSerializationWarning,
  BrentsBoundResult,
  CriticalPathDrag,
  CycleBreakCandidate,
  DependencyEdge,
  FanOutBottleneck,
  ForensicTaskNode,
  ForensicWave,
  ParallelLaneAssignment,
  QueueStallAnalysis,
  TaskSlack,
  WorkSpanMetrics,
} from "./types.ts";
export {
  allocateParallelLanes,
  computeTopologicalWaves,
  computeWorkSpan,
  detectFanOutBottlenecks,
} from "./work-span.ts";
