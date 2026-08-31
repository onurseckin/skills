/**
 * Dev Server Lifecycle Manager & State Preservation Coordinator.
 *
 * Orchestrates atomic dev server restart with state snapshot preservation,
 * graceful shutdown, port acquisition verification, and transactional rollback.
 */

import { acquireLock } from "./lock.ts";
import { captureSnapshot, StatePreserver } from "./snapshot.ts";
import { shutdownProcess } from "./shutdown.ts";
import { startServer } from "./starter.ts";
import type {
  PortConfiguration,
  RestartOptions,
  RestartResult,
  ServerStartOptions,
  ServerStateRestoreResult,
  ServerStateSnapshot,
  ServerStateSnapshotInput,
} from "./types.ts";

export class DevServerLifecycleManager {
  private readonly preserver: StatePreserver;
  private readonly defaultSnapshotPath?: string | undefined;

  public constructor(snapshotPath?: string) {
    this.defaultSnapshotPath = snapshotPath;
    this.preserver = new StatePreserver(snapshotPath);
  }

  /**
   * Returns current active state snapshot if one has been recorded.
   */
  public getState(): ServerStateSnapshot | null {
    return this.preserver.getLatest();
  }

  /**
   * Captures and records current dev server state snapshot.
   */
  public captureState(input?: ServerStateSnapshotInput): ServerStateSnapshot {
    return this.preserver.capture(input);
  }

  /**
   * Restores state from a snapshot.
   */
  public restoreState(snapshot: ServerStateSnapshot): ServerStateRestoreResult {
    return this.preserver.restore(snapshot);
  }

  /**
   * Performs an atomic dev server restart with transactional rollback guarantees.
   */
  public async restart(options?: RestartOptions): Promise<RestartResult> {
    const startTime = Date.now();

    let rollbackOnError = true;
    if (options !== undefined && options !== null && typeof options.rollbackOnError === "boolean") {
      rollbackOnError = options.rollbackOnError;
    }

    let lockOpts = undefined;
    if (options !== undefined && options !== null && options.lockOptions !== undefined) {
      lockOpts = options.lockOptions;
    }

    // Step 1: Acquire atomic restart lock to prevent concurrent restart races
    const lock = await acquireLock(lockOpts);

    let initialSnapshot: ServerStateSnapshot;
    let oldPid: number | undefined = undefined;

    try {
      // Step 2: Preserve server state snapshot before restart
      if (options !== undefined && options !== null && options.customSnapshot !== undefined) {
        initialSnapshot = options.customSnapshot;
        this.preserver.restore(initialSnapshot);
      } else {
        let capturePortConfigs: readonly PortConfiguration[] | undefined = undefined;
        let captureEnvVars: Readonly<Record<string, string>> | undefined = undefined;
        let capturePid: number | undefined = undefined;

        if (options !== undefined && options !== null) {
          capturePid = options.oldPid;
          if (options.startOptions !== undefined && options.startOptions !== null) {
            if (options.startOptions.portConfigurations !== undefined) {
              capturePortConfigs = options.startOptions.portConfigurations;
            }
            if (options.startOptions.env !== undefined) {
              captureEnvVars = options.startOptions.env;
            }
          }
        }

        initialSnapshot = this.preserver.capture({
          currentPid: capturePid,
          portConfigurations: capturePortConfigs,
          envVariables: captureEnvVars,
        });
      }

      let targetSnapPath = this.defaultSnapshotPath;
      if (
        options !== undefined &&
        options !== null &&
        options.snapshotPath !== undefined &&
        options.snapshotPath.length > 0
      ) {
        targetSnapPath = options.snapshotPath;
      }
      await this.preserver.save(initialSnapshot, targetSnapPath);

      if (options !== undefined && options !== null && options.oldPid !== undefined) {
        oldPid = options.oldPid;
      } else if (initialSnapshot.currentPid !== undefined) {
        oldPid = initialSnapshot.currentPid;
      }

      // Step 3: Coordinate graceful shutdown of old server process
      if (oldPid !== undefined && oldPid > 0) {
        let shutOpts = undefined;
        if (options !== undefined && options !== null && options.shutdownOptions !== undefined) {
          shutOpts = options.shutdownOptions;
        }
        await shutdownProcess(oldPid, shutOpts);
      }

      // Step 4: Initiate new server instance and verify port acquisition
      let startPortConfigs = initialSnapshot.portConfigurations;
      let startEnv = initialSnapshot.envVariables;
      let rawStartOptions: ServerStartOptions = {};

      if (
        options !== undefined &&
        options !== null &&
        options.startOptions !== undefined &&
        options.startOptions !== null
      ) {
        rawStartOptions = options.startOptions;
        if (options.startOptions.portConfigurations !== undefined) {
          startPortConfigs = options.startOptions.portConfigurations;
        }
        if (options.startOptions.env !== undefined) {
          startEnv = options.startOptions.env;
        }
      }

      const startOpts: ServerStartOptions = {
        ...rawStartOptions,
        portConfigurations: startPortConfigs,
        env: startEnv,
      };

      const startResult = await startServer(startOpts);

      // Step 5: Check startup result
      if (!startResult.started) {
        let rollbackError: string | undefined = undefined;

        if (rollbackOnError) {
          // Transactional rollback: restore snapshot
          this.preserver.restore(initialSnapshot);

          // Restore old server process if a restorer function was provided
          if (
            options !== undefined &&
            options !== null &&
            options.restoreOldServerFn !== undefined
          ) {
            try {
              await options.restoreOldServerFn(initialSnapshot);
            } catch (rErr: unknown) {
              let rMsg = String(rErr);
              if (rErr instanceof Error) {
                rMsg = rErr.message;
              }
              rollbackError = `Rollback server restart failed: ${rMsg}`;
            }
          }
        }

        const errParts: string[] = [];
        if (startResult.error !== undefined && startResult.error.length > 0) {
          errParts.push(startResult.error);
        }
        if (rollbackError !== undefined && rollbackError.length > 0) {
          errParts.push(rollbackError);
        }
        let compositeError = "Dev server startup failed.";
        if (errParts.length > 0) {
          compositeError = errParts.join("; ");
        }

        let restoredStateResult: ServerStateSnapshot | undefined = undefined;
        if (rollbackOnError) {
          restoredStateResult = initialSnapshot;
        }

        return {
          success: false,
          rolledBack: rollbackOnError,
          oldPid,
          snapshot: initialSnapshot,
          restoredState: restoredStateResult,
          durationMs: Date.now() - startTime,
          error: compositeError,
        };
      }

      // Step 6: On successful start, update state snapshot with new PID and PID history
      const updatedPidHistory: number[] = [];
      for (const p of initialSnapshot.pidHistory) {
        updatedPidHistory.push(p);
      }
      if (!updatedPidHistory.includes(startResult.pid)) {
        updatedPidHistory.push(startResult.pid);
      }

      const updatedSnapshot = captureSnapshot({
        activeEndpoints: initialSnapshot.activeEndpoints,
        envVariables: initialSnapshot.envVariables,
        pidHistory: updatedPidHistory,
        portConfigurations: initialSnapshot.portConfigurations,
        runFlags: initialSnapshot.runFlags,
        currentPid: startResult.pid,
        metadata: initialSnapshot.metadata,
      });

      this.preserver.restore(updatedSnapshot);
      await this.preserver.save(updatedSnapshot, targetSnapPath);

      return {
        success: true,
        rolledBack: false,
        newPid: startResult.pid,
        oldPid,
        snapshot: updatedSnapshot,
        durationMs: Date.now() - startTime,
      };
    } finally {
      // Step 7: Release atomic lock unconditionally
      await lock.release();
    }
  }
}

/**
 * Creates a new instance of DevServerLifecycleManager.
 */
export function createServerLifecycleManager(snapshotPath?: string): DevServerLifecycleManager {
  return new DevServerLifecycleManager(snapshotPath);
}

/**
 * Top-level convenience helper to restart a dev server.
 */
export async function restartDevServer(options?: RestartOptions): Promise<RestartResult> {
  const manager = new DevServerLifecycleManager();
  return manager.restart(options);
}
