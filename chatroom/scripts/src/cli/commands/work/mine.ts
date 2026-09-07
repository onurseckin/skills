import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { type HealthPorts } from "../../../daemon/index.ts";
import { formatMineRecovery, scanMineRecovery } from "../../../work/index.ts";

export const mineCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["as", "json"]);

  const asFlag = textFlag(flags, "as", false);
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const identityId = identity.id;

  const ports = (context as { ports?: HealthPorts })?.ports;
  const report = scanMineRecovery(identityId, ports);

  const markdown = formatMineRecovery(report);

  const result: Record<string, unknown> = {
    identity: report.identity,
    items_by_status: report.items_by_status,
    unseen: report.unseen,
    total_open: report.total_open,
    rooms: report.rooms,
    brief: report.brief,
    markdown,
  };

  return result;
};
