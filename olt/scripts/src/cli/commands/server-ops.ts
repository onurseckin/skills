/**
 * CLI Commands: Dev Server Status, Atomic Restart, and Port Cleanup.
 *
 * Implements server:status, server:restart, and server:clean with
 * rich markdown briefs, JSON output formatting, and flag handling.
 */

import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  captureSnapshot,
  createServerLifecycleManager,
  detectDockerPortConflicts,
  detectSocketConflict,
  findPidsOnPort,
  inspectPortOccupancy,
  probeTcpPort,
  reclaimPort,
  reclaimZombieProcesses,
  type DockerContainerConflict,
  type ProcessDetails,
  type ReclaimResult,
  type RestartResult,
  type ServerStateSnapshot,
} from "../../server/index.ts";

/**
 * Standard default ports used by modern development servers and frameworks.
 */
export const DEFAULT_DEV_PORTS: readonly number[] = [
  3000, 3001, 4000, 5000, 5173, 8000, 8080, 8888, 9000, 9229,
];

/**
 * Structured diagnostics for an inspected port.
 */
export interface ServerPortStatus {
  readonly port: number;
  readonly inUse: boolean;
  readonly available: boolean;
  readonly tcpStatus: string;
  readonly socketStatus: string;
  readonly latencyMs: number;
  readonly pids: readonly number[];
  readonly processes: readonly ProcessDetails[];
  readonly dockerConflicts: readonly DockerContainerConflict[];
  readonly error?: string | undefined;
}

function getTcpStatusBadge(status: string): string {
  if (status === "listening") {
    return "🔴 listening";
  }
  if (status === "free") {
    return "🟢 free";
  }
  if (status === "refused") {
    return "🟢 free";
  }
  return `⚪ ${status}`;
}

function resolveErrorMessage(first?: string, second?: string): string | undefined {
  if (first !== undefined && first.length > 0) {
    return first;
  }
  if (second !== undefined && second.length > 0) {
    return second;
  }
  return undefined;
}

/**
 * Formats a markdown table and summary for server:status output.
 */
export function formatServerStatusMarkdown(
  statuses: readonly ServerPortStatus[],
  scannedPorts: readonly number[],
): string {
  const occupiedCount = statuses.filter((s) => s.inUse).length;
  const totalProcesses = statuses.reduce((acc, s) => acc + s.processes.length, 0);
  const totalDockerConflicts = statuses.reduce((acc, s) => acc + s.dockerConflicts.length, 0);

  const lines: string[] = [
    "### Dev Server Status Report",
    `- **Scanned Ports**: ${scannedPorts.length} (\`${scannedPorts.join(", ")}\`)`,
    `- **Occupied Ports**: ${occupiedCount} / ${scannedPorts.length}`,
    `- **Active Server Processes**: ${totalProcesses}`,
    `- **Docker Port Collisions**: ${totalDockerConflicts}`,
    "",
    "| Port | TCP Status | Socket Available | PID(s) | Process Details | Memory | Docker Collision |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  if (statuses.length === 0) {
    lines.push("| — | — | — | — | — | — | — |");
  } else {
    for (const status of statuses) {
      const tcpIcon = getTcpStatusBadge(status.tcpStatus);
      const socketIcon = status.available ? "🟢 available" : "🔴 occupied";
      const pidsStr = status.pids.length > 0 ? status.pids.map((p) => `\`${p}\``).join(", ") : "—";

      const processStr =
        status.processes.length > 0
          ? status.processes
              .map((p) => {
                const zombieFlag = p.isZombie ? " *(zombie)*" : "";
                const orphanFlag = p.isOrphaned ? " *(orphan)*" : "";
                const cmdDisplay =
                  p.command.length > 30 ? `${p.command.slice(0, 27)}...` : p.command;
                return `${p.name} (\`${cmdDisplay}\`)${zombieFlag}${orphanFlag}`;
              })
              .join("; ")
          : "—";

      const memoryMb =
        status.processes.length > 0
          ? status.processes
              .map((p) => `${(p.memoryBytes / (1024 * 1024)).toFixed(1)} MB`)
              .join(", ")
          : "—";

      const dockerStr =
        status.dockerConflicts.length > 0
          ? status.dockerConflicts
              .map((d) => `\`${d.containerName}\` (${d.image}) -> :${d.containerPort}`)
              .join("; ")
          : "—";

      lines.push(
        `| \`${status.port}\` | ${tcpIcon} | ${socketIcon} | ${pidsStr} | ${processStr} | ${memoryMb} | ${dockerStr} |`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Formats a markdown brief for server:restart output.
 */
export function formatServerRestartMarkdown(
  result: RestartResult,
  port: number,
  dryRun: boolean,
  force: boolean,
): string {
  const statusIcon = result.success ? "✅ SUCCESS" : "❌ FAILED";
  let modeStr = "Graceful Restart";
  if (dryRun) {
    modeStr = "Dry Run (Simulated)";
  } else if (force) {
    modeStr = "Force Restart";
  }

  const lines: string[] = [
    `### Dev Server Restart: Port ${port}`,
    `- **Status**: ${statusIcon}`,
    `- **Execution Mode**: ${modeStr}`,
    `- **Target Port**: \`${port}\``,
    `- **Previous PID**: ${result.oldPid !== undefined ? `\`${result.oldPid}\`` : "—"}`,
    `- **New Server PID**: ${result.newPid !== undefined ? `\`${result.newPid}\`` : "—"}`,
    `- **Duration**: \`${result.durationMs}ms\``,
    `- **Rollback Triggered**: ${result.rolledBack ? "⚠️ Yes (Rolled back to initial state)" : "No"}`,
    `- **State Snapshot Preserved**: ${result.snapshot !== undefined ? "✅ Captured" : "—"}`,
  ];

  if (result.error !== undefined) {
    lines.push(`- **Error**: \`${result.error}\``);
  }

  return lines.join("\n");
}

/**
 * Formats a markdown brief for server:clean output.
 */
export function formatServerCleanMarkdown(
  results: readonly ReclaimResult[],
  ports: readonly number[],
  dryRun: boolean,
  force: boolean,
): string {
  const reclaimedCount = results.filter((r) => r.reclaimed).length;
  let modeStr = "Graceful Termination (SIGTERM -> SIGKILL)";
  if (dryRun) {
    modeStr = "Dry Run (Simulated)";
  } else if (force) {
    modeStr = "Force Termination (SIGKILL)";
  }

  const lines: string[] = [
    "### Dev Server Port Cleanup Summary",
    `- **Target Ports**: \`${ports.join(", ")}\``,
    `- **Execution Mode**: ${modeStr}`,
    `- **Reclaimed Processes**: ${reclaimedCount} / ${results.length}`,
    "",
    "| Port | PID | Process Name | Signal Sent | Duration | Reclaimed | Error |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  if (results.length === 0) {
    lines.push("| — | — | — | — | — | — | — |");
  } else {
    for (const r of results) {
      let reclaimedBadge = "🔴 No";
      if (r.reclaimed) {
        reclaimedBadge = "🟢 Yes";
      } else if (dryRun) {
        reclaimedBadge = "⚪ Simulated";
      }
      const errorStr = r.error !== undefined ? `\`${r.error}\`` : "—";
      lines.push(
        `| \`${r.port}\` | \`${r.pid}\` | ${r.name} | \`${r.signalSent}\` | \`${r.durationMs}ms\` | ${reclaimedBadge} | ${errorStr} |`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * CLI Handler for `server:status`
 */
export async function serverStatusCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const explicitPort = integerFlag(flags, "port", { minimum: 1, maximum: 65535 });
  const allFlag = boolFlag(flags, "all");
  const hostFlag = textFlag(flags, "host", false);
  const host = hostFlag !== undefined ? hostFlag : "127.0.0.1";

  let targetPorts: readonly number[];
  if (explicitPort !== undefined) {
    targetPorts = [explicitPort];
  } else if (allFlag) {
    targetPorts = DEFAULT_DEV_PORTS;
  } else {
    targetPorts = DEFAULT_DEV_PORTS;
  }

  const statuses: ServerPortStatus[] = [];

  for (const port of targetPorts) {
    try {
      const [tcpResult, socketResult, occupancy] = await Promise.all([
        probeTcpPort(port, { host }),
        detectSocketConflict(port, { host }),
        inspectPortOccupancy(port),
      ]);

      let dockerConflicts: readonly DockerContainerConflict[] = [];
      try {
        const dockerRes = detectDockerPortConflicts([port]);
        dockerConflicts = dockerRes.conflicts;
      } catch {
        dockerConflicts = [];
      }

      let inUse = false;
      if (tcpResult.inUse) {
        inUse = true;
      } else if (socketResult.inUse) {
        inUse = true;
      } else if (occupancy.pids.length > 0) {
        inUse = true;
      }

      let available = false;
      if (socketResult.available) {
        if (!tcpResult.inUse) {
          available = true;
        }
      }

      statuses.push({
        port,
        inUse,
        available,
        tcpStatus: tcpResult.status,
        socketStatus: socketResult.status,
        latencyMs: tcpResult.latencyMs,
        pids: occupancy.pids,
        processes: occupancy.processes,
        dockerConflicts,
        error: resolveErrorMessage(tcpResult.error, socketResult.error),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      statuses.push({
        port,
        inUse: false,
        available: false,
        tcpStatus: "error",
        socketStatus: "error",
        latencyMs: 0,
        pids: [],
        processes: [],
        dockerConflicts: [],
        error: message,
      });
    }
  }

  const markdown = formatServerStatusMarkdown(statuses, targetPorts);

  return {
    markdown,
    target_ports: targetPorts,
    total_scanned: statuses.length,
    total_occupied: statuses.filter((s) => s.inUse).length,
    total_processes: statuses.reduce((acc, s) => acc + s.processes.length, 0),
    total_docker_conflicts: statuses.reduce((acc, s) => acc + s.dockerConflicts.length, 0),
    all_available: statuses.every((s) => s.available),
    ports: statuses,
  };
}

/**
 * CLI Handler for `server:restart`
 */
export async function serverRestartCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const explicitPort = integerFlag(flags, "port", { minimum: 1, maximum: 65535 });
  const port = explicitPort !== undefined ? explicitPort : 3000;
  const force = boolFlag(flags, "force");
  const dryRun = boolFlag(flags, "dry-run");
  const command = textFlag(flags, "command", false);
  const explicitGrace = integerFlag(flags, "grace-period-ms", { minimum: 0 });
  const gracePeriodMs = explicitGrace !== undefined ? explicitGrace : 3000;
  const explicitTimeout = integerFlag(flags, "timeout", { minimum: 100 });
  const timeoutMs = explicitTimeout !== undefined ? explicitTimeout : 10000;

  if (dryRun) {
    const pids = await findPidsOnPort(port);
    const oldPid = pids[0];
    const defaultCmd = "bun run dev";
    const actualCmd = command !== undefined ? command : defaultCmd;
    const snapshot: ServerStateSnapshot = captureSnapshot({
      portConfigurations: [{ port, isPrimary: true, name: "dev-server" }],
      currentPid: oldPid,
      runFlags: { port, force, dryRun, command: actualCmd },
    });

    let newPid = 99999;
    if (oldPid !== undefined) {
      newPid = oldPid + 100;
    }

    const simulatedResult: RestartResult = {
      success: true,
      rolledBack: false,
      oldPid,
      newPid,
      snapshot,
      durationMs: 5,
    };

    const markdown = formatServerRestartMarkdown(simulatedResult, port, true, force);

    return {
      markdown,
      port,
      success: true,
      dry_run: true,
      force,
      old_pid: simulatedResult.oldPid,
      new_pid: simulatedResult.newPid,
      duration_ms: simulatedResult.durationMs,
      rolled_back: false,
      snapshot: simulatedResult.snapshot,
    };
  }

  const pids = await findPidsOnPort(port);
  const oldPid = pids[0];
  const lifecycleManager = createServerLifecycleManager();

  const shutdownGrace = force ? 0 : gracePeriodMs;
  const restartResult = await lifecycleManager.restart({
    oldPid,
    shutdownOptions: {
      gracePeriodMs: shutdownGrace,
    },
    startOptions: {
      primaryPort: port,
      command,
    },
    lockOptions: {
      timeoutMs,
    },
  });

  const markdown = formatServerRestartMarkdown(restartResult, port, false, force);

  return {
    markdown,
    port,
    success: restartResult.success,
    dry_run: false,
    force,
    old_pid: restartResult.oldPid,
    new_pid: restartResult.newPid,
    duration_ms: restartResult.durationMs,
    rolled_back: restartResult.rolledBack,
    snapshot: restartResult.snapshot,
    error: restartResult.error,
  };
}

/**
 * CLI Handler for `server:clean`
 */
export async function serverCleanCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const explicitPort = integerFlag(flags, "port", { minimum: 1, maximum: 65535 });
  const allFlag = boolFlag(flags, "all");
  const force = boolFlag(flags, "force");
  const dryRun = boolFlag(flags, "dry-run");
  const zombiesOnly = boolFlag(flags, "zombies-only");
  const explicitGrace = integerFlag(flags, "grace-period-ms", { minimum: 0 });
  const gracePeriodMs = explicitGrace !== undefined ? explicitGrace : 1000;

  let targetPorts: readonly number[];
  if (explicitPort !== undefined) {
    targetPorts = [explicitPort];
  } else if (allFlag) {
    targetPorts = DEFAULT_DEV_PORTS;
  } else {
    targetPorts = DEFAULT_DEV_PORTS;
  }

  let results: readonly ReclaimResult[] = [];

  if (zombiesOnly) {
    results = await reclaimZombieProcesses(targetPorts, {
      dryRun,
      force,
      gracePeriodMs,
    });
  } else {
    const aggregated: ReclaimResult[] = [];
    for (const port of targetPorts) {
      const portResults = await reclaimPort(port, {
        dryRun,
        force,
        gracePeriodMs,
      });
      aggregated.push(...portResults);
    }
    results = aggregated;
  }

  const markdown = formatServerCleanMarkdown(results, targetPorts, dryRun, force);
  const reclaimedCount = results.filter((r) => r.reclaimed).length;

  return {
    markdown,
    target_ports: targetPorts,
    dry_run: dryRun,
    force,
    zombies_only: zombiesOnly,
    reclaimed_count: reclaimedCount,
    total_attempted: results.length,
    all_cleaned: results.every((r) => (r.reclaimed ? true : dryRun)),
    results,
  };
}
