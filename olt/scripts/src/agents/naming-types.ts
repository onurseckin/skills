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

export const AGENT_NAMING_STANDARDS: Readonly<Record<string, AgentNamingStandardDefinition>> = {
  mind: {
    role: "mind",
    tier: 0,
    bindingType: "pulse",
    formatTemplate: "mind_<pulse-slug>",
    regexPattern: /^mind_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "mind_pulse-gen-1",
    description: "Tier 0 Mind consciousness bound to active pulse cycle",
  },
  orchestrator: {
    role: "orchestrator",
    tier: 1,
    bindingType: "phase",
    formatTemplate: "orchestrator_<run-or-phase-slug>",
    regexPattern: /^orchestrator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "orchestrator_wave-2-foundations",
    description: "Tier 1 Meta-Orchestrator bound to run or execution phase",
  },
  "mind-auditor": {
    role: "mind-auditor",
    tier: 1,
    bindingType: "audit",
    formatTemplate: "mind-auditor_<audit-window-slug>",
    regexPattern: /^mind-auditor_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "mind-auditor_audit-gen-1",
    description: "Tier 1 Independent Mind Auditor bound to audit window",
  },
  coordinator: {
    role: "coordinator",
    tier: 2,
    bindingType: "domain",
    formatTemplate: "coordinator_<domain-slug>",
    regexPattern: /^coordinator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "coordinator_domain-cli-tools",
    description: "Tier 2 Domain Coordinator bound to domain or wave scope",
  },
  implementer: {
    role: "implementer",
    tier: 3,
    bindingType: "task",
    formatTemplate: "implementer_<task-id>[-<descriptive-slug>]",
    regexPattern: /^implementer_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "implementer_task-p47-autonomic-watchdog",
    description: "Tier 3 Task Implementer strictly bound to leased task ID",
  },
  validator: {
    role: "validator",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator_task-p47-autonomic-watchdog",
    description: "Tier 3 Adversarial Validator strictly bound to validated task ID",
  },
  "mechanic-validator": {
    role: "mechanic-validator",
    tier: 3,
    bindingType: "task",
    formatTemplate: "mechanic-validator_<task-id>[-<descriptive-slug>]",
    regexPattern: /^mechanic-validator_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "mechanic-validator_task-p47-autonomic-watchdog",
    description:
      "Tier 3 Mechanic Validator strictly bound to validated task ID for deterministic test/gate execution",
  },
  "ui-mechanic-validator": {
    role: "ui-mechanic-validator",
    tier: 3,
    bindingType: "task",
    formatTemplate: "ui-mechanic-validator_<task-id>[-<descriptive-slug>]",
    regexPattern: /^ui-mechanic-validator_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "ui-mechanic-validator_task-p48-viewport-matrix",
    description:
      "Tier 3 UI Mechanic Validator bound to task ID for automated DOM metrics and screenshot capture",
  },
  "ui-validator": {
    role: "ui-validator",
    tier: 3,
    bindingType: "task",
    formatTemplate: "ui-validator_<task-id>[-<descriptive-slug>]",
    regexPattern: /^ui-validator_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "ui-validator_task-p48-viewport-matrix",
    description:
      "Tier 3 UI Cognitive Validator bound to task ID for visual aesthetics, layout, UX, and accessibility critique",
  },
  repairer: {
    role: "repairer",
    tier: 3,
    bindingType: "task",
    formatTemplate: "repairer_<task-id>[-<descriptive-slug>]",
    regexPattern: /^repairer_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "repairer_task-p47-autonomic-watchdog",
    description: "Tier 3 Task Repairer bound to leased task ID for remediation",
  },
  "completeness-critic": {
    role: "completeness-critic",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "completeness-critic_<run-or-wave-slug>",
    regexPattern: /^completeness-critic_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "completeness-critic_wave-2-foundations",
    description: "Tier 3 Completeness Critic bound to whole run or wave review",
  },
  critic: {
    role: "critic",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "completeness-critic_<run-or-wave-slug>",
    regexPattern: /^completeness-critic_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "completeness-critic_wave-2-foundations",
    description: "Tier 3 Completeness Critic bound to whole run or wave review",
  },
  planner: {
    role: "planner",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "planner_<phase-or-run-slug>",
    regexPattern: /^planner_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "planner_phase-1-planning",
    description: "Tier 3 Task Planner bound to planning phase or run",
  },
  "plan-validator": {
    role: "plan-validator",
    tier: 3,
    bindingType: "phase",
    formatTemplate: "plan-validator_<phase-or-run-slug>",
    regexPattern: /^plan-validator_[a-z0-9]+(?:-[a-z0-9]+)*$/,
    example: "plan-validator_phase-1-planning",
    description: "Tier 3 Plan Validator bound to plan review phase or run",
  },
  "validator-code-quality": {
    role: "validator-code-quality",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-code-quality_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-code-quality_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-code-quality_task-p54-agent-naming",
    description: "Tier 3 Code Quality Specialist Validator bound to task ID",
  },
  "validator-ui-design": {
    role: "validator-ui-design",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-ui-design_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-ui-design_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-ui-design_task-p48-viewport-matrix",
    description: "Tier 3 UI/Visual Design Specialist Validator bound to task ID",
  },
  "validator-security": {
    role: "validator-security",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-security_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-security_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-security_task-p49-auth-guard",
    description: "Tier 3 Security Specialist Validator bound to task ID",
  },
  "validator-product": {
    role: "validator-product",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-product_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-product_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-product_task-p50-flow-coherence",
    description: "Tier 3 Product Value Specialist Validator bound to task ID",
  },
  "validator-system-design": {
    role: "validator-system-design",
    tier: 3,
    bindingType: "task",
    formatTemplate: "validator-system-design_<task-id>[-<descriptive-slug>]",
    regexPattern: /^validator-system-design_(task-[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "validator-system-design_task-p51-schema-migration",
    description: "Tier 3 System Design Specialist Validator bound to task ID",
  },
  "sub-implementer": {
    role: "sub-implementer",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-implementer_<subtask-id>[-<descriptive-slug>]",
    regexPattern: /^sub-implementer_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-implementer_subtask-1-auth",
    description: "Tier 3 Branch Sub-Implementer bound to branch subtask ID",
  },
  "sub-validator": {
    role: "sub-validator",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-validator_<subtask-id>[-<descriptive-slug>]",
    regexPattern: /^sub-validator_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-validator_subtask-1-proof",
    description: "Tier 3 Branch Sub-Validator bound to branch subtask ID",
  },
  "sub-investigator": {
    role: "sub-investigator",
    tier: 3,
    bindingType: "subtask",
    formatTemplate: "sub-investigator_<subtask-id>[-<descriptive-slug>]",
    regexPattern:
      /^sub-investigator_(subtask-[a-z0-9]+|[a-z0-9]+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/,
    example: "sub-investigator_subtask-1-diag",
    description: "Tier 3 Branch Sub-Investigator bound to branch subtask ID",
  },
};
