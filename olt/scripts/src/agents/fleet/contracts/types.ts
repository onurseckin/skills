export type AgentTier = 0 | 1 | 2 | 3 | "independent";
export type AgentTierCategory = "governance" | "orchestration" | "execution" | "quality";

export interface ToolBoundaryDefinition {
  readonly canWriteCode: boolean;
  readonly canExecuteCommands: boolean;
  readonly canSpawnSubagents: boolean;
  readonly canClaimLeases: boolean;
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
}

export interface CertifiedDeliverable {
  readonly type: string;
  readonly description: string;
  readonly evidenceRequired: boolean;
}

export interface AgentOperationalContract {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly tier: AgentTier;
  readonly category: AgentTierCategory;
  readonly toolBoundaries: ToolBoundaryDefinition;
  readonly permissions: {
    readonly may: readonly string[];
    readonly mustNot: readonly string[];
    readonly allowedCommands: readonly string[];
    readonly forbiddenCommands: readonly string[];
    readonly allowedSpawns: readonly string[];
  };
  readonly invariants: readonly string[];
  readonly certifiedDeliverables: readonly CertifiedDeliverable[];
  readonly isHeadfulReviewer?: boolean;
  readonly isHeadlessDebugger?: boolean;
  readonly isSourceCodeBlind?: boolean;
  readonly manifestPath?: string;
}

export const FORBIDDEN_WRITE_TOOLS = [
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "create_file",
  "delete_file",
  "task:claim",
];

export function defineContract(contract: AgentOperationalContract): AgentOperationalContract {
  return Object.freeze(contract);
}
