import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserRunQueryOptions, BrowserRunRecord } from "./browser-run-types.ts";

const BROWSER_RUN_FILE = "browser-run.json";

/**
 * A browser run is something a command did, so it lives in that command's directory — the single
 * owner of every execution fact. Re-running a command replaces its file: the newest execution is
 * the one that happened.
 */
export function browserRunPath(runRoot: string, commandId: string): string {
  return join(runRoot, "commands", commandId, BROWSER_RUN_FILE);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored entry only counts once it names the command that produced it. */
function storedRun(value: unknown): BrowserRunRecord | undefined {
  if (!isRecordValue(value)) return undefined;
  const commandId = value.command_id;
  if (typeof commandId !== "string" || commandId.length === 0) return undefined;
  const classes = isRecordValue(value.evidence_classes) ? value.evidence_classes : {};
  return { ...value, command_id: commandId, evidence_classes: classes } as BrowserRunRecord;
}

export function readBrowserRun(runRoot: string, commandId: string): BrowserRunRecord | undefined {
  const path = browserRunPath(runRoot, commandId);
  if (!existsSync(path)) return undefined;
  try {
    return storedRun(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return undefined;
  }
}

export function writeBrowserRunRecord(runRoot: string, record: BrowserRunRecord): void {
  const path = browserRunPath(runRoot, record.command_id);
  try {
    mkdirSync(join(runRoot, "commands", record.command_id), { recursive: true });
    writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
  } catch {}
}

/**
 * Runs matching the recorded ids. Ownership comes from the command directory the record sits in;
 * a run is never matched to a node because a path or an actor name looked related.
 */
export function queryBrowserRuns(
  runRoot: string,
  options: BrowserRunQueryOptions = {},
): BrowserRunRecord[] {
  const commandIds =
    options.commandId === undefined ? listCommandIds(runRoot) : [options.commandId];
  const found: BrowserRunRecord[] = [];
  for (const commandId of commandIds) {
    const run = readBrowserRun(runRoot, commandId);
    if (run === undefined) continue;
    if (options.taskId !== undefined && run.task_id !== options.taskId) continue;
    found.push(run);
  }
  return found;
}

function listCommandIds(runRoot: string): string[] {
  try {
    return readdirSync(join(runRoot, "commands"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
