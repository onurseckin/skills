import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../contracts/capsule.ts";
import { issue } from "./issues.ts";
import { isRecord, type JsonRecord } from "./layout-json.ts";

// `<taskId>-submission.json` and `<taskId>-review.json` are overwritten each attempt or round;
// `<taskId>-probe-NN.json` is round-numbered and never overwritten (`cli/commands/task-review-support.ts`).
const REPORT_NAME = /^(?<taskId>.+?)-(?:submission|review|probe-\d{2})\.json$/u;
const FIXED_REPORT_NAMES = new Set(["critic-review.json"]);

/**
 * Reports have no chain-recorded digest to check content against, unlike packets and commands: a
 * review or submission document is a snapshot of the run at the moment it was written
 * (`cli/commands/task-review-support.ts` embeds the task as it stood then), and the run keeps moving
 * afterward — comparing it against *current* state would flag every task that made any progress
 * since its last review. What is safe to check without modelling that history is naming: every file
 * here should be one of the shapes the harness itself writes, and a task-prefixed one should name a
 * task this run actually has. That catches injected or orphaned files without touching content this
 * check cannot safely reason about.
 */
export function reportsLayout(runRoot: string, state: JsonRecord | undefined): IntegrityIssue[] {
  const root = join(runRoot, "reports");
  if (!existsSync(root)) return [];
  const tasks = isRecord(state?.tasks) ? (state.tasks as JsonRecord) : undefined;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    return [issue("REPORT_UNREADABLE", `reports/ is unreadable: ${String(error)}`, root)];
  }
  const found: IntegrityIssue[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const path = join(root, name);
    let isFile: boolean;
    try {
      isFile = lstatSync(path).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      found.push(
        issue("REPORT_UNDECLARED", `reports/ holds something other than a report file: ${name}`, path),
      );
      continue;
    }
    if (FIXED_REPORT_NAMES.has(name)) continue;
    const taskId = REPORT_NAME.exec(name)?.groups?.taskId;
    if (taskId === undefined) {
      found.push(issue("REPORT_UNDECLARED", `report name matches no known shape: ${name}`, path));
      continue;
    }
    if (tasks !== undefined && !(taskId in tasks))
      found.push(issue("REPORT_UNDECLARED", `report does not name a task this run knows: ${name}`, path));
  }
  return found;
}
