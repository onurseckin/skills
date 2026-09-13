export type Tier0AuditorRole = "skill-auditor" | "mind-auditor" | "skill_auditor" | "mind_auditor";

export type AgentSupervisionTier = 0 | 1 | 2 | 3;

export interface ConfinementValidationSuccess {
  readonly valid: true;
  readonly agentId: string;
  readonly role: string;
  readonly parentAgentId: string | null;
}

export interface ConfinementValidationFailure {
  readonly valid: false;
  readonly code: "ROLE_CONFINEMENT_VIOLATION";
  readonly reason: string;
  readonly agentId: string;
  readonly role: string;
  readonly attemptedParentAgentId: unknown;
}

export type ConfinementValidationResult =
  | ConfinementValidationSuccess
  | ConfinementValidationFailure;

export interface RegistrationConfinementParams {
  readonly agentId: string;
  readonly role: string;
  readonly parentAgentId?: unknown;
  readonly callerAgentId?: string | null;
  readonly callerRole?: string | null;
  readonly isRootGenesis?: boolean;
}

export interface AdoptionConfinementParams {
  readonly targetAgentId: string;
  readonly targetRole: string;
  readonly newParentAgentId?: unknown;
  readonly callerAgentId?: string | null;
  readonly callerRole?: string | null;
}

export interface SupervisoryBoundaryCheckParams {
  readonly supervisorId: string;
  readonly supervisorRole: string;
  readonly targetId: string;
  readonly targetRole: string;
  readonly action: "register" | "adopt" | "subordinate";
}
