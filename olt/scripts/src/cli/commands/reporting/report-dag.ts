import { dagViewCommand } from "../index.ts";
import type { CommandContext, Flags } from "../../index.ts";

export function reportDagCommand(
  flags: Flags,
  context: CommandContext = {},
): Record<string, unknown> {
  return dagViewCommand(flags, context);
}
