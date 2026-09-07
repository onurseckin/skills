import {
  inspectAllRooms,
  repairAllRooms,
  type DaemonLivenessState,
  type RoomHealthReport,
  type RoomRepairReport,
} from "../../doctor/index.ts";

export interface DoctorCommandFlags {
  readonly room?: string;
  readonly as?: string;
  readonly reader?: string;
  readonly fix?: boolean;
  readonly json?: boolean;
  readonly [key: string]: unknown;
}

export interface DoctorCommandResult {
  readonly markdown: string;
  readonly is_healthy: boolean;
  readonly total_issues: number;
  readonly rooms: readonly RoomHealthReport[];
  readonly repairs?: readonly RoomRepairReport[];
  readonly summary: string;
  readonly liveness_states: Record<string, Record<string, DaemonLivenessState>>;
  readonly [key: string]: unknown;
}

function readStringFlag(
  flags: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const val = flags[name];
  if (typeof val === "string" && val.length > 0) return val;
  if (Array.isArray(val) && typeof val[0] === "string" && val[0].length > 0) return val[0];
  return undefined;
}

function readBoolFlag(flags: Readonly<Record<string, unknown>>, name: string): boolean {
  const val = flags[name];
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val === "true" || val === "1";
  return false;
}

function formatMarkdownReport(
  inspection: { rooms: readonly RoomHealthReport[]; is_healthy: boolean; total_issues: number },
  repairs?: readonly RoomRepairReport[],
): string {
  const lines: string[] = [];
  lines.push("### Chatroom Doctor (`chat:doctor`)");
  lines.push(`- **Status**: \`${inspection.is_healthy ? "HEALTHY" : "DEGRADED"}\``);
  lines.push(`- **Rooms Inspected**: \`${inspection.rooms.length}\``);
  lines.push(`- **Total Issues**: \`${inspection.total_issues}\``);
  lines.push("");

  for (const r of inspection.rooms) {
    lines.push(`#### Room: \`${r.room}\``);
    lines.push(
      `- **Manifest**: \`${r.manifest.is_valid ? "VALID" : "INVALID"}\` (${r.manifest.visibility ?? "unknown"})`,
    );
    lines.push(`- **Head Sequence**: \`${r.head_seq}\``);
    lines.push(`- **Members**: \`${r.members.length}\` (${r.members.join(", ")})`);
    const quarantineWarning = r.quarantined > 0 ? " (WARNING: quarantined envelopes detected)" : "";
    lines.push(`- **Quarantined**: \`${r.quarantined}\`${quarantineWarning}`);
    lines.push(
      `- **Provisioning Drift**: \`${r.provisioning_drift ? "DRIFT_DETECTED" : "CONSISTENT"}\``,
    );
    const staleCount = r.locks.filter((l) => l.is_stale).length;
    lines.push(`- **Stale Locks**: \`${staleCount}\``);

    if (r.readers.length > 0) {
      lines.push("");
      lines.push("##### Readers");
      for (const rd of r.readers) {
        const watchLabel = rd.watch_active ? ", Watcher: ACTIVE" : "";
        const daemonInfo = `State: \`${rd.daemon_state}\` (PID: ${rd.daemon_pid !== null ? String(rd.daemon_pid) : "none"}${watchLabel})`;
        const seqInfo = `Contiguous: \`${rd.contiguous_seq}\` | Lag: \`${rd.lag}\``;

        const spoolInfo = `Spool: \`${rd.spool_bytes}\` B (\`${rd.spool_lines}\` lines)`;
        lines.push(`- **${rd.reader}**: ${daemonInfo} | ${seqInfo} | ${spoolInfo}`);
        if (rd.expired_leases.length > 0) {
          lines.push(`  - Expired Leases: \`${rd.expired_leases.length}\``);
        }
        if (rd.is_orphan) {
          lines.push("  - Warning: Orphan cursor (not in roster)");
        }
      }
    }

    if (r.issues.length > 0) {
      lines.push("");
      lines.push("##### Issues");
      for (const issue of r.issues) {
        lines.push(`- ${issue}`);
      }
    }
    lines.push("");
  }

  if (repairs !== undefined && repairs.length > 0) {
    lines.push("#### Repairs Applied");
    for (const rep of repairs) {
      const lockCount = rep.reclaimed_locks.filter((l) => l.reclaimed).length;
      const spoolCount = rep.repaired_spools.filter((s) => s.repaired).length;
      const daemonCount = rep.restarted_daemons.filter((d) => d.restarted).length;
      lines.push(
        `- **Room ${rep.room}**: Reclaimed Locks: \`${lockCount}\`, Repaired Spools: \`${spoolCount}\`, Restarted Daemons: \`${daemonCount}\``,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export async function doctorCommand(
  flags: DoctorCommandFlags | Readonly<Record<string, unknown>> = {},
  _context?: unknown,
  _remainder?: readonly string[],
): Promise<DoctorCommandResult> {
  const room = readStringFlag(flags, "room");
  const as = readStringFlag(flags, "as");
  const reader = readStringFlag(flags, "reader");
  const fix = readBoolFlag(flags, "fix");

  const isProcessAlive =
    typeof flags["isProcessAlive"] === "function"
      ? (flags["isProcessAlive"] as (pid: number) => boolean)
      : undefined;
  const now = typeof flags["now"] === "function" ? (flags["now"] as () => number) : undefined;
  const baseDir = typeof flags["baseDir"] === "string" ? flags["baseDir"] : undefined;

  const opts = {
    ...(room !== undefined ? { room } : {}),
    ...(as !== undefined ? { as } : {}),
    ...(reader !== undefined ? { reader } : {}),
    ...(isProcessAlive !== undefined ? { isProcessAlive } : {}),
    ...(now !== undefined ? { now } : {}),
    ...(baseDir !== undefined ? { baseDir } : {}),
  };

  let repairs: readonly RoomRepairReport[] | undefined;
  if (fix) {
    const repairOutcome = await repairAllRooms(opts);
    repairs = repairOutcome.reports;
  }

  const inspection = inspectAllRooms(opts);

  const livenessStates: Record<string, Record<string, DaemonLivenessState>> = {};
  for (const r of inspection.rooms) {
    const roomStates: Record<string, DaemonLivenessState> = {};
    for (const rd of r.readers) {
      roomStates[rd.reader] = rd.daemon_state;
    }
    livenessStates[r.room] = roomStates;
  }

  const markdown = formatMarkdownReport(inspection, repairs);

  return {
    markdown,
    is_healthy: inspection.is_healthy,
    total_issues: inspection.total_issues,
    rooms: inspection.rooms,
    ...(repairs !== undefined ? { repairs } : {}),
    summary: inspection.summary,
    liveness_states: livenessStates,
  };
}
