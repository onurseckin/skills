import { dagViewCommand } from "../dag-view.ts";
import type { CommandContext, Flags } from "../../options.ts";

export function reportDagCommand(
  flags: Flags,
  context: CommandContext = {},
): Record<string, unknown> {
  return dagViewCommand(flags, context);
}
