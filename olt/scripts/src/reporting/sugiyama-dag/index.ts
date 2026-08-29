/**
 * Sugiyama Hierarchical DAG Renderer & Visual Diagnostics Subsystem Facade
 */
export {
  type SugiyamaSubtask,
  type SugiyamaNode,
  type SugiyamaEdge,
  type SugiyamaRankedNode,
  type SugiyamaLayer,
  type CycleDiagnostic,
  type BypassDiagnosticItem,
  type BypassDiagnostic,
  type SugiyamaWaveMetrics,
  type SugiyamaRenderOptions,
  type SugiyamaDagReport,
  type DiagnosticHealthResult,
} from "./types.ts";
export { assignSugiyamaRanks } from "./ranking.ts";
export { minimizeCrossingsBarycenter } from "./crossing.ts";
export {
  type OrthogonalRouteSegment,
  buildOrthogonalRouteSegments,
  renderInterWaveConnector,
  renderLaneSeparator,
} from "./routing.ts";
export { detectCyclesTarjan, detectIllegalBypasses, validateDiagnosticHealth } from "./tarjan.ts";
export {
  getStatusBadge,
  getStatusGlyph,
  formatStatusBadge,
  formatSubagentAllocation,
  formatCoordinates,
  formatImplementerValidatorTracking,
  renderSubagentExpandedItems,
} from "./subagent-expansion.ts";
export { renderRoundedNodeBox } from "./render-box.ts";
export { renderSugiyamaDag, buildSugiyamaDagReport } from "./render.ts";
