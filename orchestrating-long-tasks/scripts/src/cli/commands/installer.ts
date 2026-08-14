import { installSkill } from "../../installer/install.ts";
import { installationStatus } from "../../installer/installation-status.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { assertFlags, textFlag, type Flags } from "../options.ts";

function clientsFlag(flags: Flags): string[] {
  const raw = textFlag(flags, "clients", false);
  if (raw === undefined) return [];
  const clients = raw.split(",");
  if (clients.some((client) => !client || client.trim() !== client)) {
    throw new HarnessError("INVALID_ARGUMENT", "--clients must be comma-separated nonblank names");
  }
  if (new Set(clients).size !== clients.length) {
    throw new HarnessError("INVALID_ARGUMENT", "--clients contains a duplicate");
  }
  return clients;
}

export async function installCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["source", "home", "clients"]);
  return await installSkill(
    textFlag(flags, "source")!,
    textFlag(flags, "home")!,
    clientsFlag(flags),
  );
}

export async function installationStatusCommand(flags: Flags): Promise<Record<string, unknown>> {
  assertFlags(flags, ["source", "home", "clients"]);
  const clients = clientsFlag(flags);
  return await installationStatus(
    textFlag(flags, "source")!,
    textFlag(flags, "home")!,
    clients.length ? clients : undefined,
  );
}
