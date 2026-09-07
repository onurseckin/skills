import type { AgentRole, RoleDiagnosticProfile } from "../types.ts";
import { mindProfile, policyDiscoveryProfile, skillAuditorProfile } from "./tier0/index.ts";
import { mindAuditorProfile, orchestratorProfile } from "./tier1/index.ts";
import {
  completenessCriticProfile,
  coordinatorProfile,
  planValidatorProfile,
  plannerProfile,
} from "./tier2/index.ts";
import {
  implementerProfile,
  subImplementerProfile,
  subInvestigatorProfile,
  subValidatorProfile,
  uiHeadlessValidatorProfile,
  uiOpticalValidatorProfile,
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
  ["completeness-critic", completenessCriticProfile],
  ["implementer", implementerProfile],
  ["validator", validatorProfile],
  ["ui-headless-validator", uiHeadlessValidatorProfile],
  ["ui-optical-validator", uiOpticalValidatorProfile],
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
  completenessCriticProfile,
  implementerProfile,
  validatorProfile,
  uiHeadlessValidatorProfile,
  uiOpticalValidatorProfile,
  subImplementerProfile,
  subValidatorProfile,
  subInvestigatorProfile,
};
