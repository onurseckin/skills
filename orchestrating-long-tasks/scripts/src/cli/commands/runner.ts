import { join } from "node:path";
import { runAndRecordCommand } from "../../integration/record-command.ts";
import type { CommandOptions } from "../../runner/types.ts";
import { actorFlag, assertFlags, boolFlag, integerFlag, textFlag, type Flags } from "../options.ts";

function optionalInteger(flags: Flags, name: string, maximum?: number): Record<string, number> {
  const value = integerFlag(flags, name, {
    minimum: 1,
    ...(maximum === undefined ? {} : { maximum }),
  });
  return value === undefined ? {} : { [name.replaceAll("-", "_")]: value };
}

export async function runCommandCli(
  flags: Flags,
  argv: string[],
): Promise<Record<string, unknown>> {
  assertFlags(flags, [
    "run",
    "actor",
    "cwd",
    "task",
    "gate",
    "wall-ms",
    "idle-ms",
    "grace-ms",
    "retries",
    "idempotent",
  ]);
  const run = textFlag(flags, "run")!;
  const options = {
    argv,
    cwd: textFlag(flags, "cwd")!,
    commandDir: join(run, "commands"),
    actor: actorFlag(flags),
    ...(textFlag(flags, "task", false) === undefined ? {} : { taskId: textFlag(flags, "task")! }),
    ...(textFlag(flags, "gate", false) === undefined ? {} : { gateId: textFlag(flags, "gate")! }),
    ...renamedPolicy(flags),
    idempotent: boolFlag(flags, "idempotent"),
  } satisfies CommandOptions;
  const result = await runAndRecordCommand(run, options);
  return {
    run_root: run,
    record: result.record,
    record_path: result.recordPath,
    attempts: result.attempts.map(({ record }) => record),
  };
}

function renamedPolicy(flags: Flags): Partial<CommandOptions> {
  const raw = {
    ...optionalInteger(flags, "wall-ms"),
    ...optionalInteger(flags, "idle-ms"),
    ...optionalInteger(flags, "grace-ms"),
    ...optionalInteger(flags, "retries", 5),
  };
  return {
    ...(raw.wall_ms === undefined ? {} : { wallTimeoutMs: raw.wall_ms }),
    ...(raw.idle_ms === undefined ? {} : { idleTimeoutMs: raw.idle_ms }),
    ...(raw.grace_ms === undefined ? {} : { graceMs: raw.grace_ms }),
    ...(raw.retries === undefined ? {} : { retries: raw.retries }),
  };
}
