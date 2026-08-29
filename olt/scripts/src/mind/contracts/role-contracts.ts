/**
 * Shared Leaf Contracts for Dynamic Roles & Boundary Governance
 */

export interface DynamicRoleSpec {
  readonly role: string;
  readonly tier: 0 | 1 | 2 | 3;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly prohibitedCommands?: readonly string[] | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly isValidator?: boolean | undefined;
  readonly isCognitiveValidator?: boolean | undefined;
}

export interface RoleBoundaryRule {
  readonly role: string;
  readonly maxTier: number;
  readonly allowedTools: readonly string[];
  readonly allowedCommandPatterns: readonly string[];
  readonly deniedCommandPatterns: readonly string[];
}

export interface RoleExecutionState {
  readonly role: string;
  readonly activeTaskId?: string | undefined;
  readonly toolInvocationsCount: number;
  readonly lastActionTimestamp: string;
  readonly violationsCount: number;
}
