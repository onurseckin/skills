import { HarnessError } from "../../errors/harness-error.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { writeHandoff } from "../../reporting/handoff.ts";
import { runStatus } from "../../reporting/status.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";

function clientsFlag(flags: Flags): string[] | undefined {
  const raw = textFlag(flags, "clients", false);
  if (raw === undefined) return undefined;
  const clients = raw.split(",");
  if (
    clients.some((client) => client.trim() === "" || client.trim() !== client) ||
    new Set(clients).size !== clients.length
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "--clients must contain duplicate-free comma-separated names",
    );
  }
  return clients;
}

export function statusCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run"]);
  return runStatus(textFlag(flags, "run")!);
}

export function handoffCommand(flags: Flags): Record<string, unknown> {
  assertFlags(flags, ["run"]);
  const run = textFlag(flags, "run")!;
  return { run_root: run, path: writeHandoff(run) };
}

export async function doctorCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["run", "source", "home", "clients"]);
  const run = textFlag(flags, "run")!;
  const source = textFlag(flags, "source", false);
  const home = textFlag(flags, "home", false);
  if ((source === undefined) !== (home === undefined)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "doctor installation diagnostics require source and home together",
    );
  }
  const clients = clientsFlag(flags);
  if (clients !== undefined && source === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "--clients requires --source and --home");
  }
  return runDoctor(run, {
    ...(source === undefined || home === undefined
      ? {}
      : { installation: { source, home, ...(clients === undefined ? {} : { clients }) } }),
  });
}
