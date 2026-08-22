import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDagJsonReport } from "../../reporting/graph-json.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import { resolveCapsuleRun } from "./dag-view.ts";

export function exportGraphJsonCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  
  const report = generateDagJsonReport(run);

  const out = textFlag(flags, "out", false);
  const pretty = boolFlag(flags, "pretty");

  const jsonStr = pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);

  if (out) {
    const outPath = resolve(process.cwd(), out);
    writeFileSync(outPath, jsonStr, "utf8");
    return { ...report, exported_to: outPath };
  }

  return report as unknown as Record<string, unknown>;
}
