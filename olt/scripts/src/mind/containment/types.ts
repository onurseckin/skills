export type ContainmentStrike = 0 | 1 | 2 | 3;

export type SupervisoryViolationType =
  | "DIRECT_CODE_EDIT"
  | "DIRECT_TEST_RUN"
  | "DIRECT_MUTATION_COMMAND"
  | "BYPASS_DELEGATION"
  | "CRITIC_JOB_EXECUTION";

export interface SupervisoryViolation {
  readonly violationId: string;
  readonly agentId: string;
  readonly role: string;
  readonly violationType: SupervisoryViolationType;
  readonly attemptedAction: string;
  readonly targetFile?: string | undefined;
  readonly timestamp: string;
  readonly details?: string | undefined;
}

export type ContainmentActionType =
  | "ALLOW"
  | "HALT_AND_DELEGATE"
  | "CAPABILITY_REVOCATION"
  | "PERSONA_RESPAWN";

export interface ContainmentResult {
  readonly action: ContainmentActionType;
  readonly strikeLevel: ContainmentStrike;
  readonly blocked: boolean;
  readonly message: string;
  readonly violation?: SupervisoryViolation | undefined;
  readonly revokedTools?: readonly string[] | undefined;
  readonly sanitizedState?: boolean | undefined;
  readonly respawnRequired?: boolean | undefined;
}

export interface AgentContainmentState {
  readonly agentId: string;
  readonly role: string;
  readonly strikeCount: ContainmentStrike;
  readonly violations: readonly SupervisoryViolation[];
  readonly capabilitiesRevoked: boolean;
  readonly revokedTools: readonly string[];
  readonly isTerminated: boolean;
  readonly lastViolationAt?: string | undefined;
}

export interface InterceptActionParams {
  readonly agentId: string;
  readonly role: string;
  readonly actionType: SupervisoryViolationType;
  readonly attemptedAction: string;
  readonly targetFile?: string | undefined;
  readonly details?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface ContainmentEngineOptions {
  readonly strikeDecayMs?: number | undefined;
  readonly customRevokedTools?: readonly string[] | undefined;
  readonly onViolation?:
    | ((violation: SupervisoryViolation, result: ContainmentResult) => void)
    | undefined;
}

export interface SerializedContainmentEngine {
  readonly version: number;
  readonly agentStates: readonly AgentContainmentState[];
  readonly options?: ContainmentEngineOptions | undefined;
}
