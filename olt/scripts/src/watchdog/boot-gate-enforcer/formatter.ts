import type { SubagentBootGateRecord } from "./types.ts";

export function renderAsciiBootGateTable(records: readonly SubagentBootGateRecord[]): string {
  if (records.length === 0) {
    return "No subagents registered in boot gate tracker.";
  }

  const lines: string[] = [];
  lines.push(
    "| Agent ID             | Tier | Role         | PID   | whoami | doctor | Boot Gate | Last Activity       |",
  );
  lines.push(
    "|----------------------|------|--------------|-------|--------|--------|-----------|---------------------|",
  );

  for (const r of records) {
    const agentCol = r.agentId.padEnd(20).slice(0, 20);
    const tierCol = `T${r.tier}`.padEnd(4);
    const roleCol = r.role.padEnd(12).slice(0, 12);
    const pidCol = (r.pid !== undefined ? String(r.pid) : "-").padEnd(5);
    const whoamiCol = (r.whoamiExecuted ? "PASS ✅" : "FAIL ❌").padEnd(6);
    const doctorCol = (r.doctorExecuted ? "PASS ✅" : "FAIL ❌").padEnd(6);
    const gateCol = (r.bootGatePassed ? "READY ✅" : "BLOCKED ❌").padEnd(9);
    const actCol = r.lastActivityAt.slice(11, 19).padEnd(19);

    lines.push(
      `| ${agentCol} | ${tierCol} | ${roleCol} | ${pidCol} | ${whoamiCol} | ${doctorCol} | ${gateCol} | ${actCol} |`,
    );
  }

  return lines.join("\n");
}
