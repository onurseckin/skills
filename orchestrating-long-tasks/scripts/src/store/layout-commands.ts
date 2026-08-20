import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../contracts/capsule.ts";
import { readCanonicalObject, sameJson } from "../core/json.ts";
import { issue } from "./issues.ts";
import { isRecord, text, type JsonRecord } from "./layout-json.ts";

const COMMAND_ID_PATTERN = /^C-[0-9A-Za-z-]+$/u;
const MAX_COMMAND_RECORD_READ_BYTES = 16 * 1024 * 1024;
const TERMINAL_COMMAND_STATUSES = new Set(["succeeded", "failed", "timed_out"]);

/**
 * `record_path` is a required field of every real `CommandRecord` (`contracts/commands.ts`), always
 * set by `prepareCommand` to the command's own directory. A state entry with no `record_path` at all
 * is not a command the harness ever ran through that path — most often a minimal fixture built
 * directly on `state.commands` for a test unrelated to command execution — so it makes no disk claim
 * this check can verify, and is skipped rather than treated as a command missing its record.
 *
 * `commands/<id>/record.json` is written before the command is ever named in state —
 * `prepareCommand` reserves the directory and publishes the record, and only afterward does
 * `recordCommandIntent` commit the id into `state.commands` (`runner/internal-command-runner.ts`,
 * `integration/record-command.ts`). For a command that DID go through that path, the file is
 * therefore already on disk by the time state names it; a genuine command whose record later goes
 * missing is left to the doctor-tier `verifyCommandRecord`, which is meant to run deliberately rather
 * than on every load. Content equality is checked only once the harness has settled on a terminal
 * status: a running command's record is republished repeatedly as attempts land, so comparing it
 * against the frozen intent snapshot in state would flag a command a concurrent reader simply caught
 * mid-flight, not a tampered one. The exact match holds from a terminal status onward because
 * `assertVerified` inside `reconcileCommandResult` proves disk and state agree at the instant that
 * status commits, and nothing rewrites the file afterward.
 *
 * There is deliberately no reverse "undeclared command directory" check either: the directory and
 * its record are reserved and written before the state commit that would declare them, so a
 * directory with no `state.commands` entry yet is the same ordinary, recoverable gap as the packet
 * case in `layout-packets.ts`, not evidence of tampering.
 */
function commandRecordIssues(runRoot: string, id: string, record: JsonRecord): IntegrityIssue[] {
  if (!COMMAND_ID_PATTERN.test(id))
    return [issue("COMMAND_ID", `command id is not safe to address: ${id}`, "commands")];
  const declaredPath = text(record.record_path);
  if (declaredPath === undefined) return [];
  const expectedPath = `commands/${id}/record.json`;
  if (declaredPath !== expectedPath)
    return [
      issue("COMMAND_PATH", `command ${id} declares a record path outside its directory`, expectedPath),
    ];
  const recordPath = join(runRoot, "commands", id, "record.json");
  if (!existsSync(recordPath)) return [];
  const status = text(record.status);
  if (status === undefined || !TERMINAL_COMMAND_STATUSES.has(status)) return [];
  const found: IntegrityIssue[] = [];
  try {
    const stored = readCanonicalObject(recordPath, `command ${id} record`, {
      maxBytes: MAX_COMMAND_RECORD_READ_BYTES,
      maxDepth: 64,
    });
    if (!sameJson(stored, record))
      found.push(
        issue(
          "COMMAND_RECORD_CONTENT",
          `command ${id} record no longer matches its recorded state`,
          recordPath,
        ),
      );
  } catch (error) {
    found.push(issue("COMMAND_UNREADABLE", `command ${id} record is unreadable: ${String(error)}`, recordPath));
  }
  return found;
}

/** `commands/<id>/record.json` checked against the terminal command state the chain settled on. */
export function commandLayout(runRoot: string, state: JsonRecord | undefined): IntegrityIssue[] {
  const declared = isRecord(state?.commands) ? (state.commands as JsonRecord) : {};
  const found: IntegrityIssue[] = [];
  for (const [id, value] of Object.entries(declared)) {
    if (!isRecord(value)) continue;
    found.push(...commandRecordIssues(runRoot, id, value));
  }
  return found;
}
