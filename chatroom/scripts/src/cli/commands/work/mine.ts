import {
  assertFlags,
  boolFlag,
  textFlag,
  type CommandContext,
  type CommandHandler,
  type Flags,
} from "../shared/index.ts";
import { resolveIdentity } from "../../../identity/index.ts";
import { type HealthPorts } from "../../../daemon/index.ts";
import { scanMineRecovery, type MineRecoveryReport } from "../../../work/index.ts";

function formatTerminalRecoveryView(report: MineRecoveryReport): string {
  const lines: string[] = [];
  lines.push(`Recovery View: ${report.identity} (${report.total_open} open items)`);
  lines.push("=".repeat(60));

  if (report.unseen.length > 0) {
    lines.push("");
    lines.push(`*** UNSEEN WORK ITEMS (${report.unseen.length}) ***`);
    for (const item of report.unseen) {
      lines.push(`  [UNSEEN] ${item.id} - ${item.title}`);
      lines.push(`    Room: ${item.room} | Status: ${item.status}`);
      lines.push(`    Last Thread Message: ${item.last_thread_message ?? "(none)"}`);
    }
  }

  const statuses = ["in_progress", "review", "blocked", "open"] as const;
  for (const status of statuses) {
    const items = report.items_by_status[status] ?? [];
    if (items.length > 0) {
      lines.push("");
      const label = status.replace(/_/g, " ").toUpperCase();
      lines.push(`-- ${label} (${items.length}) --`);
      for (const item of items) {
        const unseenTag = item.accepted_at === null ? " [UNSEEN]" : "";
        lines.push(`  * ${item.id}: ${item.title}${unseenTag}`);
        lines.push(`    Room: ${item.room} | Status: ${item.status}`);
        lines.push(`    Last Thread Message: ${item.last_thread_message ?? "(none)"}`);
      }
    }
  }

  if (report.total_open === 0) {
    lines.push("");
    lines.push("No open work items found.");
  }

  return lines.join("\n");
}

export const mineCommand: CommandHandler = async (
  flags: Flags,
  context: CommandContext,
  _remainder: readonly string[],
): Promise<Record<string, unknown>> => {
  assertFlags(flags, ["as", "json"]);

  const asFlag = textFlag(flags, "as", false);
  const jsonFlag = boolFlag(flags, "json");

  const identity = resolveIdentity({ as: asFlag, cwd: process.cwd() });
  const identityId = identity.id;

  const ports = (context as { ports?: HealthPorts })?.ports;
  const report = scanMineRecovery(identityId, ports);

  const markdown = formatTerminalRecoveryView(report);

  const result: Record<string, unknown> = {
    identity: report.identity,
    items_by_status: report.items_by_status,
    unseen: report.unseen,
    total_open: report.total_open,
    markdown,
  };

  return result;
};
