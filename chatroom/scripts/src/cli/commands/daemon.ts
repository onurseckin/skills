import {
  assertFlags,
  boolFlag,
  intFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "./shared/index.ts";
import { assertValidRoomId, ChatError, daemonHealthPath } from "../../core/index.ts";
import { assertMember } from "../../room/index.ts";
import { resolveIdentity } from "../../identity/index.ts";
import {
  computeDaemonState,
  ensureDaemon,
  inspectDaemon,
  readHealthRecord,
  runDaemonLoop,
  startDaemon,
  stepDaemonLoop,
  stopDaemon,
} from "../../daemon/index.ts";

export const daemonCommand: CommandHandler = async (
  flags: Flags,
  _context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, [
    "room",
    "as",
    "reader",
    "start",
    "stop",
    "status",
    "tick",
    "foreground",
    "poll-interval",
    "json",
  ]);

  const roomFlag = textFlag(flags, "room", true);
  if (roomFlag === undefined) {
    throw new ChatError("INVALID_ARGUMENT", "--room is required");
  }
  assertValidRoomId(roomFlag);

  const asFlag = textFlag(flags, "as", false);
  const readerFlag = textFlag(flags, "reader", false);
  const startFlag = boolFlag(flags, "start");
  const stopFlag = boolFlag(flags, "stop");
  const statusFlag = boolFlag(flags, "status");
  const tickFlag = boolFlag(flags, "tick");
  const foregroundFlag = boolFlag(flags, "foreground");
  const pollIntervalFlag = intFlag(flags, "poll-interval", { minimum: 250 });
  const jsonFlag = boolFlag(flags, "json");

  const isStart = Boolean(startFlag || foregroundFlag);
  const actionCount = [isStart, stopFlag, statusFlag, tickFlag].filter(Boolean).length;
  if (actionCount !== 1) {
    throw new ChatError(
      "INVALID_ARGUMENT",
      "Exactly one of --start, --stop, --status, --tick, or --foreground must be specified",
    );
  }

  const identity = resolveIdentity({ as: asFlag ?? readerFlag, cwd: process.cwd() });
  const readerId = readerFlag !== undefined ? readerFlag : identity.id;

  assertMember(roomFlag, identity);

  try {
    ensureDaemon(roomFlag, readerId, { autoStart: false });
  } catch {}

  if (isStart) {
    if (foregroundFlag) {
      await runDaemonLoop({
        room: roomFlag,
        reader: readerId,
        ...(pollIntervalFlag !== undefined ? { pollIntervalMs: pollIntervalFlag } : {}),
      });
      return {
        room: roomFlag,
        reader: readerId,
        status: "stopped",
        foreground: true,
      };
    }

    const res = startDaemon({
      room: roomFlag,
      reader: readerId,
      ...(pollIntervalFlag !== undefined ? { pollIntervalMs: pollIntervalFlag } : {}),
    });
    const result: Record<string, unknown> = {
      room: roomFlag,
      reader: readerId,
      status: res.status,
      pid: res.pid,
    };
    if (!jsonFlag) {
      process.stdout.write(
        `Daemon status: ${res.status}${res.pid !== undefined && res.pid !== null ? ` (PID: ${res.pid})` : ""}\n`,
      );
    }
    return result;
  }

  if (stopFlag) {
    const res = stopDaemon({
      room: roomFlag,
      reader: readerId,
    });
    const result: Record<string, unknown> = {
      room: roomFlag,
      reader: readerId,
      status: res.status,
      pid: res.pid,
    };
    if (!jsonFlag) {
      process.stdout.write(
        `Daemon stopped${res.pid !== undefined && res.pid !== null ? ` (PID: ${res.pid})` : ""}\n`,
      );
    }
    return result;
  }

  if (statusFlag) {
    const inspection = inspectDaemon(roomFlag, readerId);
    if (inspection.health === null) {
      const result: Record<string, unknown> = {
        room: roomFlag,
        reader: readerId,
        state: "STOPPED",
        health: null,
        watch_active: false,
      };
      if (!jsonFlag) {
        process.stdout.write("Daemon state: STOPPED (no health record)\n");
      }
      return result;
    }

    const result: Record<string, unknown> = {
      room: roomFlag,
      reader: readerId,
      state: inspection.state,
      health: inspection.health,
      watch_active: inspection.watch_active,
    };
    if (!jsonFlag) {
      process.stdout.write(`Daemon state: ${inspection.state} (PID: ${inspection.health.pid})\n`);
      process.stdout.write(
        `Delivered seq: ${inspection.health.last_delivered_seq}, Lag: ${inspection.health.lag_seqs}\n`,
      );
      process.stdout.write(`Watch active: ${inspection.watch_active}\n`);
    }
    return result;
  }

  const stepRes = stepDaemonLoop({
    room: roomFlag,
    reader: readerId,
    ...(pollIntervalFlag !== undefined ? { pollIntervalMs: pollIntervalFlag } : {}),
  });

  const result: Record<string, unknown> = {
    room: roomFlag,
    reader: readerId,
    status: "ticked",
    delivered: stepRes.delivered,
    remaining: stepRes.remaining,
    idle: stepRes.idle,
  };

  if (!jsonFlag) {
    process.stdout.write(
      `Tick completed: delivered ${stepRes.delivered} messages (${stepRes.remaining} remaining)\n`,
    );
  }

  return result;
};
