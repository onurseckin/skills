import { boolFlag, textFlag, type CommandContext, type Flags } from "../../options.ts";
import { resolveCapsuleRun } from "../dag-view.ts";
import { generateUnifiedReport } from "../../../reporting/unified/index.ts";

export function reportUnifiedCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const detailed = boolFlag(flags, "detailed");
  const asJson = boolFlag(flags, "json");

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const report = generateUnifiedReport(run, { detailed });
  return {
    ...(report as unknown as Record<string, unknown>),
    ...(asJson ? { json: true } : {}),
  };
}
