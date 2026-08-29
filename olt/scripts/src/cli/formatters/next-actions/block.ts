import type { NextActionItem } from "./types.ts";

export function nextActionsBlock(actions: readonly (NextActionItem | string)[]): string[] {
  if (actions.length === 0) return [];
  const lines: string[] = ["", "⚡ Next Actions:"];
  for (const [i, action] of actions.entries()) {
    if (typeof action === "string") {
      lines.push(`${i + 1}. \`${action}\``);
    } else {
      const roleStr = action.role ? ` [${action.role}]` : "";
      const descStr = action.description ? ` — ${action.description}` : "";
      lines.push(`${i + 1}. \`${action.command}\`${roleStr}${descStr}`);
    }
  }
  return lines;
}

export function formatNextActions(actions: readonly (NextActionItem | string)[]): string {
  return nextActionsBlock(actions).join("\n").trim();
}
