import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../../../core/contracts/index.ts";
import { readCanonicalObject, sameJson } from "../../../core/json.ts";
import { issue } from "../integrity/issues.ts";
import { isRecord, text, type JsonRecord } from "./layout-json.ts";

const COMMAND_ID_PATTERN = /^C-[0-9A-Za-z-]+$/u;
const MAX_COMMAND_RECORD_READ_BYTES = 16 * 1024 * 1024;
const TERMINAL_COMMAND_STATUSES = new Set(["succeeded", "failed", "timed_out"]);

function commandRecordIssues(runRoot: string, id: string, record: JsonRecord): IntegrityIssue[] {
  if (!COMMAND_ID_PATTERN.test(id))
    return [issue("COMMAND_ID", `command id is not safe to address: ${id}`, "commands")];
  const declaredPath = text(record.record_path);
  if (declaredPath === undefined) return [];
  const expectedPath = `commands/${id}/record.json`;
  if (declaredPath !== expectedPath)
    return [
      issue(
        "COMMAND_PATH",
        `command ${id} declares a record path outside its directory`,
        expectedPath,
      ),
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
    found.push(
      issue(
        "COMMAND_UNREADABLE",
        `command ${id} record is unreadable: ${String(error)}`,
        recordPath,
      ),
    );
  }
  return found;
}

export function commandLayout(runRoot: string, state: JsonRecord | undefined): IntegrityIssue[] {
  const declared = isRecord(state?.commands) ? (state.commands as JsonRecord) : {};
  const found: IntegrityIssue[] = [];
  for (const [id, value] of Object.entries(declared)) {
    if (!isRecord(value)) continue;
    found.push(...commandRecordIssues(runRoot, id, value));
  }
  return found;
}
