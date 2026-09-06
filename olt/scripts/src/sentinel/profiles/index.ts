import type { AgentRole, RoleDiagnosticProfile } from "../types.ts";
import { mindProfile, policyDiscoveryProfile, skillAuditorProfile } from "./tier0/index.ts";
import { mindAuditorProfile, orchestratorProfile } from "./tier1/index.ts";
import {
  completenessCriticProfile,
  coordinatorProfile,
  planValidatorProfile,
  plannerProfile,
  repairerProfile,
} from "./tier2/index.ts";
import {
  implementerProfile,
  mechanicValidatorProfile,
  subImplementerProfile,
  subInvestigatorProfile,
  subValidatorProfile,
  uiHeadlessValidatorProfile,
  uiMechanicValidatorProfile,
  uiOpticalValidatorProfile,
  uiValidatorProfile,
  validatorProfile,
} from "./tier3/index.ts";

export const ALL_PROFILES: ReadonlyMap<AgentRole, RoleDiagnosticProfile> = new Map([
  ["mind", mindProfile],
  ["skill-auditor", skillAuditorProfile],
  ["policy-discovery", policyDiscoveryProfile],
  ["orchestrator", orchestratorProfile],
  ["mind-auditor", mindAuditorProfile],
  ["coordinator", coordinatorProfile],
  ["planner", plannerProfile],
  ["plan-validator", planValidatorProfile],
  ["repairer", repairerProfile],
  ["completeness-critic", completenessCriticProfile],
  ["implementer", implementerProfile],
  ["validator", validatorProfile],
  ["mechanic-validator", mechanicValidatorProfile],
  ["ui-headless-validator", uiHeadlessValidatorProfile],
  ["ui-mechanic-validator", uiMechanicValidatorProfile],
  ["ui-optical-validator", uiOpticalValidatorProfile],
  ["ui-validator", uiValidatorProfile],
  ["sub-implementer", subImplementerProfile],
  ["sub-validator", subValidatorProfile],
  ["sub-investigator", subInvestigatorProfile],
]);

export function getProfileForRole(role: AgentRole): RoleDiagnosticProfile {
  const profile = ALL_PROFILES.get(role);
  if (!profile) {
    throw new Error(`No diagnostic profile configured for canonical role: ${role}`);
  }
  return profile;
}

export {
  mindProfile,
  skillAuditorProfile,
  policyDiscoveryProfile,
  orchestratorProfile,
  mindAuditorProfile,
  coordinatorProfile,
  plannerProfile,
  planValidatorProfile,
  repairerProfile,
  completenessCriticProfile,
  implementerProfile,
  validatorProfile,
  mechanicValidatorProfile,
  uiHeadlessValidatorProfile,
  uiMechanicValidatorProfile,
  uiOpticalValidatorProfile,
  uiValidatorProfile,
  subImplementerProfile,
  subValidatorProfile,
  subInvestigatorProfile,
};
