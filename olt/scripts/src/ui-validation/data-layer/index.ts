export type {
  SyntheticFixtureType,
  SyntheticFixture,
  SchemaFieldRule,
  PayloadSchema,
  PreFlightCertificationResult,
  RoutedDefectReceipt,
  VisualFoundationHandoffToken,
  HandoffVerificationResult,
  DisambiguationEvaluationResult,
} from "./types.ts";

export { SYNTHETIC_FIXTURE_TYPES } from "./types.ts";

export {
  computePayloadSha256,
  createDashboardTelemetryFixtures,
  createUserManagementFixtures,
  validatePayloadSchema,
} from "./fixtures.ts";

export {
  DataLayerPreFlightCertifier,
  DefectRouter,
  VisualFoundationHandoffGate,
} from "./certifier.ts";

export {
  DisambiguationGatewayEngine,
  getDefaultDisambiguationGatewayEngine,
  setDefaultDisambiguationGatewayEngine,
  resetDefaultDisambiguationGatewayEngine,
} from "./engine.ts";
