export {
  type SugiyamaNodeBadge,
  type SubagentNode,
  type SugiyamaSubtask,
  type SugiyamaNode,
  type SugiyamaEdge,
  type DirectedGraph,
  type SugiyamaDag,
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
  insertVirtualDummyNodes,
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
  expandSubagentSubgraphs,
} from "./subagent-expansion.ts";
export {
  renderSugiyamaNodeBox,
  renderRoundedNodeBox,
  getOpticalDisplayWidth,
  stripAnsiCodes,
  padOptical,
  truncateOptical,
} from "./render-box.ts";
export { renderSugiyamaDag, generateSugiyamaDagReport, buildSugiyamaDagReport } from "./render.ts";
