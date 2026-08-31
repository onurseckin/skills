/**
 * Dev Server Lifecycle & State Preservation Type Definitions.
 *
 * Defines contracts for snapshot preservation, atomic locking, graceful shutdown,
 * port acquisition verification, and transactional rollback during server restarts.
 */

export interface ServerEndpoint {
  readonly path: string;
  readonly method?: string | undefined;
  readonly port?: number | undefined;
  readonly name?: string | undefined;
}

export interface PortConfiguration {
  readonly port: number;
  readonly protocol?: "tcp" | "udp" | undefined;
  readonly host?: string | undefined;
  readonly isPrimary?: boolean | undefined;
  readonly name?: string | undefined;
}

export interface ServerStateSnapshot {
  readonly activeEndpoints: readonly ServerEndpoint[];
  readonly envVariables: Readonly<Record<string, string>>;
  readonly pidHistory: readonly number[];
  readonly portConfigurations: readonly PortConfiguration[];
  readonly runFlags: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly currentPid?: number | undefined;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
}

export interface ServerStateSnapshotInput {
  readonly activeEndpoints?: readonly ServerEndpoint[] | undefined;
  readonly envVariables?: Readonly<Record<string, string>> | undefined;
  readonly pidHistory?: readonly number[] | undefined;
  readonly portConfigurations?: readonly PortConfiguration[] | undefined;
  readonly runFlags?:
    | Readonly<Record<string, string | number | boolean | readonly string[]>>
    | undefined;
  readonly currentPid?: number | undefined;
  readonly timestamp?: string | undefined;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
}

export interface LockOptions {
  readonly lockPath?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly staleLockAgeMs?: number | undefined;
  readonly lockHolderId?: string | undefined;
}

export interface LockHandle {
  readonly lockPath: string;
  readonly lockHolderId: string;
  readonly acquiredAt: string;
  readonly release: () => Promise<void>;
}

export type ShutdownSignal = "SIGTERM" | "SIGKILL" | "NONE";

export interface ShutdownOptions {
  readonly gracePeriodMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly signalSender?: ((pid: number, signal: "SIGTERM" | "SIGKILL") => boolean) | undefined;
  readonly isAliveChecker?: ((pid: number) => boolean) | undefined;
  readonly sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

export interface ShutdownResult {
  readonly pid: number;
  readonly stopped: boolean;
  readonly signalSent: ShutdownSignal;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export interface ServerStartOptions {
  readonly command?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly cwd?: string | undefined;
  readonly portConfigurations?: readonly PortConfiguration[] | undefined;
  readonly primaryPort?: number | undefined;
  readonly bindTimeoutMs?: number | undefined;
  readonly bindPollIntervalMs?: number | undefined;
  readonly portChecker?: ((port: number, host?: string) => Promise<boolean>) | undefined;
  readonly spawnServerFn?:
    | ((options: ServerStartOptions) => Promise<{ readonly pid: number }>)
    | undefined;
  readonly sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

export interface ServerStartResult {
  readonly pid: number;
  readonly boundPorts: readonly number[];
  readonly started: boolean;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export interface ServerStateRestoreResult {
  readonly restored: boolean;
  readonly snapshot: ServerStateSnapshot;
  readonly targetPid?: number | undefined;
  readonly error?: string | undefined;
}

export interface RestartOptions {
  readonly oldPid?: number | undefined;
  readonly shutdownOptions?: ShutdownOptions | undefined;
  readonly startOptions?: ServerStartOptions | undefined;
  readonly lockOptions?: LockOptions | undefined;
  readonly snapshotPath?: string | undefined;
  readonly customSnapshot?: ServerStateSnapshot | undefined;
  readonly rollbackOnError?: boolean | undefined;
  readonly restoreOldServerFn?:
    | ((snapshot: ServerStateSnapshot) => Promise<{ readonly pid: number }>)
    | undefined;
}

export interface RestartResult {
  readonly success: boolean;
  readonly rolledBack: boolean;
  readonly snapshotRestored?: boolean | undefined;
  readonly serverProcessRestored?: boolean | undefined;
  readonly newPid?: number | undefined;
  readonly oldPid?: number | undefined;
  readonly snapshot: ServerStateSnapshot;
  readonly restoredState?: ServerStateSnapshot | undefined;
  readonly durationMs: number;
  readonly error?: string | undefined;
}
