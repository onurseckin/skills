import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntegrityIssue } from "../../core/contracts/capsule.ts";
import { issue } from "./issues.ts";
import { isRecord, type JsonRecord } from "./layout-json.ts";

const REPORT_NAME = /^(?<taskId>.+?)-(?:submission|review|probe-\d{2})\.json$/u;
const FIXED_REPORT_NAMES = new Set(["critic-review.json"]);

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
    let kind: "file" | "directory" | "other";
    try {
      const stat = lstatSync(path);
      kind = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
    } catch {
      kind = "other";
    }
    if (kind === "directory") continue;
    if (kind === "other") {
      found.push(
        issue(
          "REPORT_UNDECLARED",
          `reports/ holds something other than a report file: ${name}`,
          path,
        ),
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
      found.push(
        issue("REPORT_UNDECLARED", `report does not name a task this run knows: ${name}`, path),
      );
  }
  return found;
}
