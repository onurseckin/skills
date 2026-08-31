/**
 * Agent Grants Facade.
 */
export {
  registerAgentGrant,
  releaseAgentGrant,
  recordAgentReport,
  type RegisterAgentGrantInput,
  type ReleaseAgentGrantInput,
  type RecordAgentReportInput,
} from "../../../olt/scripts/src/workflow/agents/grants.ts";

export {
  seededRun,
  ledgerOf,
  eventKinds,
  lastPayload,
  registerCoordinator,
} from "./agent-grant-fixtures.ts";
