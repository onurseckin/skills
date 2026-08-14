import { dirname, join } from "node:path";

export interface TaskView {
  id: string;
  status: string;
  requirement_ids: string[];
  owner: string | null;
  role: string | null;
  attempt: number | null;
  repair_assignee: string | null;
  original_implementer: string | null;
  gate_results: { gate_id: string; command_id: string }[];
  validation: { validator_id: string; attempt: number } | null;
}

export interface GateView {
  id: string;
  scope: "run" | "task";
  cwd: string;
  command: string | string[];
  requirement_ids: string[];
}

export interface PacketView {
  id: string;
  role: string;
  agent_id: string;
  task_id: string | null;
  attempt: number;
  markdown_path: string;
}

export interface CommandView {
  id: string;
  status: string;
  task_id: string | null;
  gate_id: string | null;
}

export const placeholder = (label: string) => `<${label}>`;

export function packetSecret(_packet: PacketView | undefined): string {
  return placeholder("host-only-bearer-secret-not-stored-in-packet");
}

export function gateCommand(
  prefix: string[],
  runRoot: string,
  gate: GateView,
  taskId?: string,
): string[] {
  const repository = dirname(dirname(runRoot));
  const argv = Array.isArray(gate.command) ? gate.command : [gate.command];
  return [
    ...prefix,
    "run",
    "--run",
    runRoot,
    "--actor",
    "coordinator",
    "--cwd",
    gate.cwd === "." ? repository : join(repository, gate.cwd),
    ...(taskId ? ["--task", taskId] : []),
    "--gate",
    gate.id,
    "--",
    ...argv,
  ];
}
