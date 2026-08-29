/**
 * Sugiyama Hierarchical DAG Renderer & Visual Diagnostics Subsystem Facade
 */
export {
  type SugiyamaNodeBadge,
  type SugiyamaSubtask,
  type SugiyamaNode,
  type SugiyamaEdge,
  type SugiyamaRankedNode,
  type SugiyamaLayer,
  type OrthogonalEdgeSegment,
  type OrthogonalRouteSegment,
  type CycleDiagnostic,
  type BypassDiagnosticItem,
  type BypassDiagnostic,
  type SugiyamaWaveMetrics,
  type SugiyamaRenderOptions,
  type SugiyamaDagReport,
  type DiagnosticHealthResult,
} from "./types.ts";
export {
  assignSugiyamaRanks,
  boundLayerWidthCoffmanGraham,
  computeLexicographicLabels,
} from "./ranking.ts";
export { countLayerCrossings, barycentricSort, minimizeCrossingsBarycenter } from "./crossing.ts";
export {
  buildOrthogonalRouteSegments,
  renderOrthogonalConnectors,
  renderInterWaveConnector,
  renderLaneSeparator,
} from "./routing.ts";
export {
  detectCyclesTarjan,
  extractFeedbackArcSet,
  reverseCycleEdges,
  detectIllegalBypasses,
  validateDiagnosticHealth,
} from "./tarjan.ts";
export {
  getStatusBadge,
  getStatusGlyph,
  getNodeStatusGlyph,
  formatNodeBadges,
  formatStatusBadge,
  formatSubagentAllocation,
  formatCoordinates,
  formatImplementerValidatorTracking,
  renderSubagentExpandedItems,
} from "./subagent-expansion.ts";
export { renderSugiyamaNodeBox, renderRoundedNodeBox } from "./render-box.ts";
export { renderSugiyamaDag, generateSugiyamaDagReport, buildSugiyamaDagReport } from "./render.ts";
