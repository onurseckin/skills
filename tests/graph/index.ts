// Root Facade for tests/graph/ Domain

// 1. Audit Subdomain
export {
  auditPlanGraph,
  auditA1Granularity,
  auditA3GateDiscrimination,
  auditA4FalseBarrier,
  auditA5Straggler,
  auditA6WholeSuiteGate,
  auditA7RelationalCoupling,
  auditA8MissingProofRecord,
} from "./audit/index.ts";

// 2. Proof Subdomain
export {
  evaluateGateFalsifiability,
  recordGateProof,
  appendGateProof,
  readGateProofs,
  latestGateProof,
  installGateProofSpies,
  cleanupProofRepos,
} from "./proof/index.ts";

// 3. Gates Subdomain
export {
  evaluateOwnershipGates,
  validateGateCommand,
  validateGatePathDiagnostics,
  validateGateToolGrammar,
} from "./gates/index.ts";

// 4. Decoupling Subdomain
export {
  decoupleDisjointTasks,
  detectArtificialSerialization,
  computeWorkSpanMetrics,
  partitionDynamicLanes,
  allocateParallelLanes,
} from "./decoupling/index.ts";

// 5. Expansion Subdomain
export {
  allocateDynamicSubtasks,
  createImplementerValidatorPair,
  detectTransitiveBypasses,
  expandDeeper,
  expandWider,
  expandDynamicPlan,
  replanFromFindings,
  validateExpansionLimits,
} from "./expansion/index.ts";

// 6. Forensics Subdomain
export {
  analyzeBottlenecks,
  computeCriticalPath,
  computeWorkSpan,
  calculateBrentsTheorem,
  computeCriticalPathDrag,
  detectFanOutBottlenecks,
  analyzeQueueStalls,
  computeTaskSlack,
  findCycles,
  breakCycles,
} from "./forensics/index.ts";

// 7. Revision Subdomain
export {
  applyPlan,
  guardPlanRevision,
  projectPlan,
  readPlanObject,
  executionActive,
  gateContractActive,
  producedArtifacts,
  requirementContract,
  taskContract,
  taskGates,
  compileUnifiedHighLeveragePlan,
  detectCapsuleContext,
  expandDynamicPlanUnified,
} from "./revision/index.ts";

// 8. Topology Subdomain
export {
  dependencyData,
  describeCycle,
  downstreamMap,
  topologicalOrder,
  type DependencyMap,
  analyzeTopologyDeclaration,
  assertTopologyJustified,
  dependencyMap,
  assignSugiyamaRanks,
  barycentricSort,
  boundLayerWidthCoffmanGraham,
  buildOrthogonalRouteSegments,
  buildSugiyamaDagReport,
  computeLexicographicLabels,
  countLayerCrossings,
  detectCyclesTarjan,
  detectIllegalBypasses,
  extractFeedbackArcSet,
  formatCoordinates,
  formatImplementerValidatorTracking,
  formatNodeBadges,
  formatStatusBadge,
  formatSubagentAllocation,
  generateSugiyamaDagReport,
  getNodeStatusGlyph,
  getStatusBadge,
  getStatusGlyph,
  minimizeCrossingsBarycenter,
  renderInterWaveConnector,
  renderLaneSeparator,
  renderOrthogonalConnectors,
  renderRoundedNodeBox,
  renderSubagentExpandedItems,
  renderSugiyamaDag,
  renderSugiyamaNodeBox,
  reverseCycleEdges,
  validateDiagnosticHealth,
} from "./topology/index.ts";

// 9. Validation Subdomain
export {
  graphDocument,
  validPlanningDocuments,
  taskById,
  MemoryPlanningStore,
  PlanFixture,
  setupVirtualGraphFS,
  cleanupVirtualGraphFS,
  installPlanFsSpies,
  clearPlanFs,
  validateGraph,
  validateEdges,
  validateGates,
  validateRoles,
  validateTasks,
  analyzeScopeIndependence,
  checkScopeOverlap,
  computeConcurrencyWaves,
  normalizeScopePath,
  enumerateGlobMatches,
  globToRegExp,
  partitionByGlob,
  slugifyScope,
  BrainstormEngine,
  SOCRATIC_VECTORS,
  type SocraticVector,
  type ExpandedBrainstormItem,
  type BrainstormResult,
} from "./validation/index.ts";
