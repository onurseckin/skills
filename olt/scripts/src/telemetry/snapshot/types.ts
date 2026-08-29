export interface QuotaDagSnapshotTask {
  id: string;
  status: string;
  effortMath: string;
  agent?: string | undefined;
  dependencies: string[];
}

export interface QuotaDagSnapshotAgent {
  id: string;
  role: string;
  status: string;
}

export interface QuotaDagSnapshotWave {
  waveId: string;
  status: string;
  lanes: string[];
}

export interface QuotaDagSnapshotCron {
  cronId: string;
  expression: string;
  purpose: string;
}

export interface QuotaDagSnapshot {
  version: "2";
  repositoryRoot: string;
  runRoot: string;
  frozenAt: string;
  resumedAt?: string | undefined;
  status: "frozen" | "resumed";
  activeWave?: QuotaDagSnapshotWave | undefined;
  tasks: QuotaDagSnapshotTask[];
  agents: QuotaDagSnapshotAgent[];
  cronsSuspended: QuotaDagSnapshotCron[];
  uncommittedFiles: string[];
  lowestQuotaObserved: number | null;
  constrainedModels: string[];
  autoWakeSchedule: { resetTime: string; resumeTime: string };
}

export interface CaptureDagSnapshotOptions {
  runRoot: string;
  repositoryRoot: string;
  lowestQuotaObserved: number | null;
  constrainedModels: string[];
  resetTime: string;
}

export interface ResumeDagSnapshotOptions {
  repoRoot: string;
  runRoot: string;
  clearAfterResume?: boolean | undefined;
}

export interface ResumeDagSnapshotResult {
  restoredWaveLanes: string[];
  cronsToReRegister: QuotaDagSnapshotCron[];
  resumeDirectives: string[];
}

export const DEFAULT_QUOTA_SNAPSHOT_FILENAME = "quota-dag-snapshot.json";

export const STANDARD_SUPERVISORY_CRONS: QuotaDagSnapshotCron[] = [
  { cronId: "mind-pulse", expression: "*/5 * * * *", purpose: "Mind pulse" },
  { cronId: "mind-auditor-live", expression: "*/3 * * * *", purpose: "Mind Auditor live" },
  { cronId: "skill-auditor-live", expression: "*/3 * * * *", purpose: "Skill Auditor live" },
  { cronId: "orchestrator-cadence", expression: "*/5 * * * *", purpose: "Orchestrator cadence" },
];

export type SnapshotPersistenceStage =
  | "before_write"
  | "before_file_fsync"
  | "before_rename"
  | "after_rename"
  | "before_directory_fsync";
