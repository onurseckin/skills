import type { CommandContext, Flags } from "../../index.ts";
import { reportUnifiedCommand as baseReportUnifiedCommand } from "../index.ts";

export function reportUnifiedCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  return baseReportUnifiedCommand(flags);
}
