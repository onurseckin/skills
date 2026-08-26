import { dagViewCommand, resolveCapsuleRun } from "./dag-view.ts";
import { boolFlag, textFlag, type Flags } from "../options.ts";
import {
  generateLeasesReport,
  generateDecisionsReport,
  generateUnifiedReport,
} from "../../reporting/unified.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import { formatDoctorBrief } from "./diagnostics-ops.ts";
import { summaryExportCommand } from "./summary-ops.ts";

export function reportUnifiedCommand(flags: Flags): Record<string, unknown> {
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

export function reportDagCommand(
  flags: Flags,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  return dagViewCommand(flags);
}

export function reportGraphCommand(
  flags: Flags,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  return dagViewCommand(flags);
}

export function reportGraphJsonCommand(flags: Flags): Record<string, unknown> {
  return summaryExportCommand(flags);
}

export async function reportHealthCommand(flags: Flags): Promise<Record<string, unknown>> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const source = textFlag(flags, "source", false);
  const home = textFlag(flags, "home", false);
  const clients = textFlag(flags, "clients", false);

  const installation =
    source !== undefined && home !== undefined
      ? {
          installation: {
            source,
            home,
            ...(clients === undefined
              ? {}
              : {
                  clients: clients
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean),
                }),
          },
        }
      : {};

  const report = await runDoctor(run, installation);
  return { ...report, markdown: formatDoctorBrief(run, report), run_root: run };
}

export function reportLeasesCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  return generateLeasesReport(run);
}

export function reportDecisionsCommand(flags: Flags): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);
  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  return generateDecisionsReport(run);
}
