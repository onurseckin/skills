import type { ExecutionTier } from "../thread-identifier.ts";

export interface SessionIdentity {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: ExecutionTier;
  readonly token: string;
  readonly pid: number;
  readonly ppid: number;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly can_execute_shell: boolean;
  readonly can_edit_files: boolean;
  readonly host: string;
  readonly mechanisms_detected: readonly string[];
  readonly granted_at: string;
}

export interface RegisterSessionOptions {
  runRoot?: string | undefined;
  agentId: string;
  role: string;
  host?: string | undefined;
  pid?: number | undefined;
  ppid?: number | undefined;
  taskId?: string | undefined;
  writeScope?: readonly string[] | undefined;
  worktreeDir?: string | undefined;
  customToken?: string | undefined;
  bindProcessAncestry?: boolean | undefined;
}

export interface ResolveSessionOptions {
  cwd?: string | undefined;
  pid?: number | undefined;
  ppid?: number | undefined;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined;
  explicitActor?: string | undefined;
  explicitToken?: string | undefined;
  runRoot?: string | undefined;
  readPersistedSessionFile?: ((path: string, encoding: "utf8") => string) | undefined;
}

export interface SessionSnapshot {
  readonly path: string;
  readonly bytes: string | null;
}

export interface StagedSessionGrant {
  readonly session: SessionIdentity;
  readonly repoRoot: string;
  readonly globalDir: string;
  readonly payload: string;
  readonly processSnapshots: readonly SessionSnapshot[];
  readonly capsuleSnapshot?: SessionSnapshot | undefined;
}
