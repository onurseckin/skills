export type ExecutionTier = 0 | 1 | 2 | 3;

export type StandardAgentRole =
  | "mind"
  | "orchestrator"
  | "mind-auditor"
  | "coordinator"
  | "implementer"
  | "validator"
  | "mechanic-validator"
  | "ui-mechanic-validator"
  | "ui-validator"
  | "repairer"
  | "completeness-critic"
  | "critic"
  | "planner"
  | "plan-validator"
  | "validator-code-quality"
  | "validator-ui-design"
  | "validator-security"
  | "validator-product"
  | "validator-system-design"
  | "sub-implementer"
  | "sub-validator"
  | "sub-investigator";

export interface DefectRecord {
  id: string;
  type:
    | "main_thread_direct_execution"
    | "main_thread_boundary_violation"
    | "role_escalation"
    | "unauthorized_mutation"
    | "role_confinement_violation"
    | "cross_tier_spawn_violation";
  severity: "critical" | "warning";
  timestamp: string;
  pid: number;
  ppid: number;
  agent_id: string | null;
  observation: string;
  remediation: string;
  context: {
    cwd: string;
    indicators: Record<string, string>;
    matched_action?: string;
  };
}

export interface HostProfile {
  app_id: string;
  os_platform: string;
  os_release: string;
  os_arch: string;
  runtime_node: string | null;
  runtime_bun: string | null;
}

export interface CapabilitiesProfile {
  tools: readonly string[];
  environment_grants: readonly string[];
  command_taxonomy: string;
}

export interface ThreadIdentification {
  pid: number;
  ppid: number;
  tier: ExecutionTier;
  tier_name: string;
  role: string | null;
  agent_id: string | null;
  is_main_thread: boolean;
  compliance_state: "compliant" | "restrained" | "violation";
  advisory: string | null;
  indicators: Record<string, string>;
  defect: DefectRecord | null;
  host_profile: HostProfile;
  capabilities: CapabilitiesProfile;
}

export interface ExecutionContextOptions {
  pid?: number | undefined;
  ppid?: number | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  cwd?: string | undefined;
  runRoot?: string | undefined;
  agentId?: string | undefined;
  role?: string | undefined;
  tier?: ExecutionTier | undefined;
  isInteractiveMainThread?: boolean | undefined;
  argv?: readonly string[] | undefined;
}

export interface TierSpawningValidationResult {
  readonly allowed: boolean;
  readonly parentTier: ExecutionTier;
  readonly childTier: ExecutionTier;
  readonly parentRole: string | null;
  readonly childRole: string | null;
  readonly reason: string | null;
}

export type AgentBindingType = "pulse" | "phase" | "domain" | "task" | "subtask" | "audit";

export interface AgentNamingStandardDefinition {
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly bindingType: AgentBindingType;
  readonly formatTemplate: string;
  readonly regexPattern: RegExp;
  readonly example: string;
  readonly description: string;
}

export interface StandardAgentIdParsedComponents {
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly bindingType: AgentBindingType;
  readonly contextOrTaskId: string;
  readonly taskId?: string | undefined;
  readonly taskSlug?: string | undefined;
}

export interface AgentNamingValidationResult {
  readonly valid: boolean;
  readonly agentId: string;
  readonly role: string | null;
  readonly tier: ExecutionTier | null;
  readonly parsedComponents: StandardAgentIdParsedComponents | null;
  readonly reason: string | null;
  readonly recommendedAgentId: string | null;
}
