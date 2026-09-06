import type { AgentRole } from "../index.ts";

export interface LiveStrategyMonitor {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly transcriptPath: string;
  readonly targetWorktree?: string | undefined;
  readonly parentSupervisor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  isMonitoring(): boolean;
  start(): void;
  stop(): void;
  pollNow(): void;
}

export interface CreateMonitorOptions {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly transcriptPath: string;
  readonly targetWorktree?: string | undefined;
  readonly parentSupervisor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly taskId?: string | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly initialOffset?: number | undefined;
  readonly autoStart?: boolean | undefined;
  readonly onStop?: (() => void) | undefined;
}

export interface SentinelMonitorDescriptor {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly transcriptPath: string;
  readonly targetWorktree?: string | undefined;
  readonly parentSupervisor?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly isMonitoring: boolean;
}

export const PROHIBITED_SUPERVISORY_TOOLS = [
  "run_command",
  "execute_command",
  "shell",
  "exec",
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch_file",
] as const;

export type ProhibitedSupervisoryTool = (typeof PROHIBITED_SUPERVISORY_TOOLS)[number];
