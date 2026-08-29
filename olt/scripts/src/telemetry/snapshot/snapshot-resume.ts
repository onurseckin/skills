import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { emitTelemetryEvent } from "../../reporting/telemetry-stream.ts";
import type {
  QuotaDagSnapshot,
  ResumeDagSnapshotOptions,
  ResumeDagSnapshotResult,
} from "./types.ts";
import { withSnapshotLock } from "./snapshot-lock.ts";
import { parseSnapshot, requiredText, secureRead, writeAtomic } from "./snapshot-persistence.ts";

export async function resumeDagSnapshot(
  options: ResumeDagSnapshotOptions,
): Promise<ResumeDagSnapshotResult> {
  const repoRoot = resolve(requiredText(options.repoRoot, "repoRoot"));
  const runRoot = resolve(requiredText(options.runRoot, "runRoot"));
  return withSnapshotLock(repoRoot, (path) => {
    const raw = secureRead(path, false);
    if (raw === undefined)
      throw new HarnessError("INVALID_STATE", "no quota snapshot is available to resume");
    const snapshot = parseSnapshot(raw);
    if (snapshot.repositoryRoot !== repoRoot || snapshot.runRoot !== runRoot)
      throw new HarnessError("INTEGRITY", "quota snapshot is bound to another repository or run");
    if (snapshot.status !== "frozen")
      throw new HarnessError("INVALID_STATE", "quota snapshot is already resumed");
    if (options.clearAfterResume)
      throw new HarnessError("INVALID_ARGUMENT", "quota snapshot must remain as durable evidence");
    const resumed: QuotaDagSnapshot = {
      ...snapshot,
      status: "resumed",
      resumedAt: new Date().toISOString(),
    };
    writeAtomic(path, resumed);
    emitTelemetryEvent(
      {
        timestamp: new Date().toISOString(),
        actor: "system",
        action: "QUOTA_RESUME_SNAPSHOT",
        status: "success",
        details: { resumedAt: resumed.resumedAt!, frozenAt: snapshot.frozenAt },
      },
      repoRoot,
    );
    const restoredWaveLanes = snapshot.activeWave?.lanes ?? [];
    const cronsToReRegister = snapshot.cronsSuspended;
    return {
      restoredWaveLanes,
      cronsToReRegister,
      resumeDirectives: [
        `Re-register crons: ${cronsToReRegister.map((cron) => cron.cronId).join(", ")}`,
        `Resume wave lanes: ${restoredWaveLanes.join(", ")}`,
      ],
    };
  });
}

export function formatDagResumeMarkdown(result: ResumeDagSnapshotResult, detailed = false): string {
  let markdown = `## DAG Resume State\n\n### Restored Wave Lanes\n${result.restoredWaveLanes.length ? result.restoredWaveLanes.map((lane) => `- ${lane}`).join("\n") : "*None*"}\n\n### Crons to Re-Register\n${result.cronsToReRegister.length ? result.cronsToReRegister.map((cron) => `- **${cron.cronId}**: \`${cron.expression}\` (${cron.purpose})`).join("\n") : "*None*"}\n`;
  if (detailed && result.resumeDirectives.length)
    markdown += `\n### Directives\n${result.resumeDirectives.map((directive) => `- ${directive}`).join("\n")}\n`;
  return markdown;
}
