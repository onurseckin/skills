import type { CommandContext, Flags } from "../../options.ts";
import { reportUnifiedCommand as baseReportUnifiedCommand } from "../unified-reporting.ts";

export function reportUnifiedCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  return baseReportUnifiedCommand(flags);
}
