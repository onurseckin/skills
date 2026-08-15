import { enforceLineLimit, formatTable } from "./line-limiter.ts";

export interface QueueNextParams {
  taskId: string;
  label: string;
  priority: number;
  goal?: string;
  writeScope: readonly string[];
  gateCmd: string;
  packetPath?: string;
  runId: string;
}

export function formatQueueNextBrief(params: QueueNextParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const goalStr = params.goal ?? params.label;
  const md = [
    `### Ready Task: ${params.taskId} (Priority: ${params.priority})`,
    `- **Label**: ${params.label}`,
    `- **Goal**: ${goalStr}`,
    `- **Write Scope**: ${scopeStr}`,
    `- **Mandatory Gate**: \`${params.gateCmd}\``,
    "",
    `#### Claim Command:`,
    "```bash",
    `bun harness.ts task:claim --run ${params.runId} --task ${params.taskId} --agent <AGENT_ID>`,
    "```",
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatQueueEmptyBrief(runId: string): string {
  const md = [
    `### Queue Status: ${runId}`,
    `- **Ready Tasks**: 0 tasks available for immediate lease.`,
    `- **Status**: All remaining tasks are currently leased, validating, blocked on dependencies, or satisfied.`,
    `- **Action**: Run \`bun harness.ts queue:list --run ${runId}\` or \`bun harness.ts run:status --run ${runId}\` to inspect active lanes.`,
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface LeasedItem {
  id: string;
  agent: string;
  timeLeft?: string;
}

export interface BlockedItem {
  id: string;
  waitingOn: readonly string[];
}

export interface QueueListPartitions {
  ready: readonly string[];
  leased: readonly LeasedItem[];
  validating: readonly string[];
  blocked: readonly BlockedItem[];
  satisfied: readonly string[];
  repairNeeded?: readonly string[];
}

export function formatQueueListBrief(partitions: QueueListPartitions, maxParallel = 3): string {
  const headers = ["Partition", "Count", "Tasks"];
  const rows: string[][] = [];

  const readyStr = partitions.ready.length > 0 ? partitions.ready.map((t) => `\`${t}\``).join(", ") : "-";
  rows.push(["🟢 **Ready**", String(partitions.ready.length), readyStr]);

  const leasedStr = partitions.leased.length > 0
    ? partitions.leased.map((l) => `\`${l.id}\` (Agent: \`${l.agent}\`${l.timeLeft ? `, Exp: ${l.timeLeft}` : ""})`).join(", ")
    : "-";
  rows.push(["🔄 **Leased**", String(partitions.leased.length), leasedStr]);

  const valStr = partitions.validating.length > 0 ? partitions.validating.map((t) => `\`${t}\``).join(", ") : "-";
  rows.push(["🔍 **Validating**", String(partitions.validating.length), valStr]);

  const blockedStr = partitions.blocked.length > 0
    ? partitions.blocked.map((b) => `\`${b.id}\` (waiting for: ${b.waitingOn.map((w) => `\`${w}\``).join(", ")})`).join(", ")
    : "-";
  rows.push(["⏳ **Blocked**", String(partitions.blocked.length), blockedStr]);

  const satStr = partitions.satisfied.length > 0 ? partitions.satisfied.map((t) => `\`${t}\``).join(", ") : "-";
  rows.push(["✅ **Satisfied**", String(partitions.satisfied.length), satStr]);

  if (partitions.repairNeeded && partitions.repairNeeded.length > 0) {
    const repStr = partitions.repairNeeded.map((t) => `\`${t}\``).join(", ");
    rows.push(["🛠️ **Repair Needed**", String(partitions.repairNeeded.length), repStr]);
  }

  const activeCount = partitions.leased.length + partitions.validating.length;
  const lines = [
    `### Execution Queue Summary`,
    ...formatTable(headers, rows),
    "",
    `**Parallel Concurrency**: ${activeCount}/${maxParallel} active lanes utilized. ${partitions.ready.length} ready tasks available.`,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface QueuePopParams {
  taskId: string;
  agent: string;
  token: string;
  deadlineMinutes: number;
  expiresAt: string;
  writeScope: readonly string[];
  gateCmd: string;
  packetPath?: string;
}

export function formatQueuePopBrief(params: QueuePopParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const md = [
    `### Task Popped & Leased: ${params.taskId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Lease Token**: \`${params.token}\``,
    `- **Deadline**: ${params.deadlineMinutes}m (Expires: ${params.expiresAt})`,
    `- **Write Scope**: ${scopeStr}`,
    `- **Mandatory Gate**: \`${params.gateCmd}\``,
  ].join("\n");
  return enforceLineLimit(md, 30);
}
