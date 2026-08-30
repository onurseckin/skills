import { existsSync, readFileSync } from "node:fs";
import type { CommandReceiptProof, EventLogSummary } from "./types.ts";

export function inspectEventLogEvidence(eventsPath: string): EventLogSummary {
  if (!existsSync(eventsPath)) {
    return {
      eventsPath,
      exists: false,
      totalEvents: 0,
      maxSequence: 0,
      commandReceiptsCount: 0,
      commandReceipts: [],
      shaChainValid: false,
      containsIgnitionEvent: false,
      containsCompletionEvent: false,
      parseErrors: [],
    };
  }

  const receipts: CommandReceiptProof[] = [];
  const parseErrors: string[] = [];
  let totalEvents = 0;
  let maxSeq = 0;
  let hasIgnition = false;
  let hasCompletion = false;
  let shaChainValid = true;
  let previousSha: string | undefined;

  try {
    const raw = readFileSync(eventsPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      totalEvents += 1;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const seq = typeof event.sequence === "number" ? event.sequence : 0;
        if (seq > maxSeq) maxSeq = seq;

        const eventType = typeof event.type === "string" ? event.type : "";
        if (eventType.includes("ignition") || eventType.includes("init")) hasIgnition = true;
        if (eventType.includes("complete") || eventType.includes("finish")) hasCompletion = true;

        if (eventType === "command-executed" || eventType === "command_executed") {
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          receipts.push({
            taskId: String(payload.task_id ?? "unknown"),
            actor: String(payload.actor ?? "unknown"),
            command: String(payload.command ?? ""),
            argv: Array.isArray(payload.argv) ? (payload.argv as string[]) : [],
            exitCode: typeof payload.exit_code === "number" ? payload.exit_code : 0,
            stdoutHash: String(payload.stdout_hash ?? ""),
            timestamp: typeof event.timestamp === "string" ? event.timestamp : undefined,
            eventSequence: seq,
          });
        }

        const sha = typeof event.sha === "string" ? event.sha : undefined;
        const parentSha = typeof event.parent_sha === "string" ? event.parent_sha : undefined;

        if (sha && parentSha && previousSha) {
          if (parentSha !== previousSha) shaChainValid = false;
        }
        if (sha) previousSha = sha;
      } catch (err) {
        parseErrors.push(err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    parseErrors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    eventsPath,
    exists: true,
    totalEvents,
    maxSequence: maxSeq,
    commandReceiptsCount: receipts.length,
    commandReceipts: receipts,
    shaChainValid,
    containsIgnitionEvent: hasIgnition,
    containsCompletionEvent: hasCompletion,
    parseErrors,
  };
}
