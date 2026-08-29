export interface TaskBriefParams {
  taskId: string;
  label?: string | undefined;
  role?: string | undefined;
  agent?: string | undefined;
  writeScope: readonly string[];
  worktreePath?: string | undefined;
  targetFiles?: readonly string[] | undefined;
  recommendedCommands?: readonly string[] | undefined;
  gateCommands?: readonly string[] | undefined;
  acceptanceCriteria?: readonly string[] | undefined;
  nextSteps?: readonly string[] | undefined;
}

export interface TaskClaimParams {
  taskId: string;
  agent: string;
  token: string;
  durationMinutes: number;
  writeScope: readonly string[];
  packetPath?: string | undefined;
  worktreePath?: string | undefined;
  targetFiles?: readonly string[] | undefined;
  recommendedCommands?: readonly string[] | undefined;
}

export interface TaskHeartbeatParams {
  taskId: string;
  agent: string;
  extendedMinutes: number;
  newDeadline: string;
}

export interface TaskSubmitParams {
  taskId: string;
  agent: string;
  filesTouchedCount: number;
  writeScope: readonly string[];
  linesAdded?: number;
  linesRemoved?: number;
  reportPath: string;
}

export interface ValidationStartParams {
  taskId: string;
  validator: string;
  token: string;
  gates: readonly string[];
  packetPath?: string | undefined;
  minProbes?: number | undefined;
  targetFiles?: readonly string[] | undefined;
  recommendedCommands?: readonly string[] | undefined;
  writeScope?: readonly string[] | undefined;
}

export interface TaskReviewPassParams {
  taskId: string;
  validator: string;
  gateSummary: string;
  unblockedTasks?: readonly string[];
  reportPath: string;
  probeRounds?: number;
  taskStatus: string;
  outstandingDomains?: readonly string[];
}

export interface TaskRejectParams {
  taskId: string;
  validator: string;
  findingId: string;
  issue: string;
  status: string;
}

export interface TaskProbeParams {
  taskId: string;
  validator: string;
  round: number;
  demands: readonly { id: string; demand: string }[];
  repairRound: number;
  warning?: string | undefined;
}

export interface TaskAssignRepairerParams {
  taskId: string;
  replacementId: string;
  reason: string;
  evidence: string;
}
