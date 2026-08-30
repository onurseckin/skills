import type { CommandReceiptInfo } from "./types.ts";

function extractReceiptFromRecord(
  sourceRecord: Record<string, unknown>,
  source: "event" | "state",
): CommandReceiptInfo | null {
  const payload =
    typeof sourceRecord["payload"] === "object" && sourceRecord["payload"] !== null
      ? (sourceRecord["payload"] as Record<string, unknown>)
      : sourceRecord;

  const command =
    typeof payload["command"] === "string"
      ? payload["command"]
      : typeof sourceRecord["command"] === "string"
        ? sourceRecord["command"]
        : null;

  if (!command) {
    return null;
  }

  const actor =
    typeof payload["actor"] === "string"
      ? payload["actor"]
      : typeof sourceRecord["actor"] === "string"
        ? (sourceRecord["actor"] as string)
        : "unknown";

  const rawExitCode = payload["exit_code"] ?? sourceRecord["exit_code"];
  const exitCode = typeof rawExitCode === "number" ? rawExitCode : -1;

  const taskId =
    typeof payload["task_id"] === "string"
      ? payload["task_id"]
      : typeof sourceRecord["task_id"] === "string"
        ? (sourceRecord["task_id"] as string)
        : undefined;

  const rawArgv = payload["argv"] ?? sourceRecord["argv"];
  const argv = Array.isArray(rawArgv)
    ? rawArgv.filter((a): a is string => typeof a === "string")
    : undefined;

  const stdoutHash =
    typeof payload["stdout_hash"] === "string"
      ? payload["stdout_hash"]
      : typeof sourceRecord["stdout_hash"] === "string"
        ? (sourceRecord["stdout_hash"] as string)
        : undefined;

  const timestamp =
    typeof sourceRecord["timestamp"] === "string"
      ? (sourceRecord["timestamp"] as string)
      : typeof payload["timestamp"] === "string"
        ? (payload["timestamp"] as string)
        : undefined;

  return {
    taskId,
    actor,
    command,
    argv,
    exitCode,
    stdoutHash,
    timestamp,
    valid: exitCode === 0,
    source,
  };
}

export function inspectCommandReceipts(
  events: readonly Record<string, unknown>[],
  stateObj?: Record<string, unknown> | undefined,
): readonly CommandReceiptInfo[] {
  const receipts: CommandReceiptInfo[] = [];

  for (const event of events) {
    const kind = event["kind"] ?? event["type"];
    if (kind === "command-executed" || kind === "run-exec" || kind === "task-executed") {
      const receipt = extractReceiptFromRecord(event, "event");
      if (receipt) {
        receipts.push(receipt);
      }
    }
  }

  if (stateObj) {
    const stateReceipts = stateObj["receipts"];
    if (
      typeof stateReceipts === "object" &&
      stateReceipts !== null &&
      !Array.isArray(stateReceipts)
    ) {
      const recordMap = stateReceipts as Record<string, unknown>;
      for (const key of Object.keys(recordMap)) {
        const item = recordMap[key];
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const receipt = extractReceiptFromRecord(item as Record<string, unknown>, "state");
          if (receipt) {
            receipts.push(receipt);
          }
        }
      }
    }

    const stateCommands = stateObj["commands"];
    if (
      typeof stateCommands === "object" &&
      stateCommands !== null &&
      !Array.isArray(stateCommands)
    ) {
      const commandMap = stateCommands as Record<string, unknown>;
      for (const key of Object.keys(commandMap)) {
        const item = commandMap[key];
        if (typeof item === "object" && item !== null && !Array.isArray(item)) {
          const receipt = extractReceiptFromRecord(item as Record<string, unknown>, "state");
          if (receipt) {
            receipts.push(receipt);
          }
        }
      }
    }
  }

  return receipts;
}

export function inspectMilestoneEvents(
  events: readonly Record<string, unknown>[],
): ReadonlySet<string> {
  const kinds = new Set<string>();
  for (const event of events) {
    const kind = event["kind"] ?? event["type"];
    if (typeof kind === "string" && kind.length > 0) {
      kinds.add(kind);
    }
  }
  return kinds;
}
