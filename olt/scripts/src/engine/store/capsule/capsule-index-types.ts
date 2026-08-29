import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { JsonObject, JsonValue, Manifest, RunState } from "../../../core/contracts/index.ts";
import { capturesPath, type CaptureKind, CAPTURES_FILE } from "./captures.ts";
import { contentDigest } from "../content-normalization/index.ts";
import { runFilePath } from "./paths.ts";

export const INDEX_FILE = "index.json";
export const INDEX_SCHEMA = "harness.index";

export interface CapsuleIndex {
  schema: typeof INDEX_SCHEMA;
  version: 1;
  derived: true;
  run_id: string;
  generated_at: string;
  index_of_event: { sequence: number; head: string | null };
  index_of_captures: string | null;
  tasks: IndexTask[];
  commands: IndexCommand[];
  findings: IndexFinding[];
  reports: IndexReport[];
  captures: IndexCapture[];
  blobs: IndexBlob[];
  packets: IndexPacket[];
}

export interface IndexTask {
  id: string;
  status: string;
  requirement_ids: string[];
  command_ids: string[];
  finding_ids: string[];
  open_finding_ids: string[];
}

export interface IndexCommand {
  id: string;
  path: string;
  status?: string;
  exit_code?: number;
  task_id?: string;
  gate_id?: string;
  actor?: string;
  started_at?: string;
  finished_at?: string;
}

export interface IndexFinding {
  id: string;
  task_id: string;
  requirement_id?: string;
  severity?: string;
  status?: string;
}

export interface IndexReport {
  name: string;
  path: string;
  bytes: number;
  task_id?: string;
  round?: number;
}

export interface IndexCapture {
  kind: CaptureKind;
  name: string;
  sha256: string;
  path: string;
  bytes: number;
  task_id?: string;
  command_id?: string;
}

export interface IndexBlob {
  sha256: string;
  bytes: number;
  path: string;
  references: number;
}

export interface IndexPacket {
  id: string;
  role: string;
  agent_id: string;
  task_id: string | null;
  path: string;
}

export type IndexFreshness = "current" | "stale" | "unknown";

export interface LoadedIndex {
  runRoot: string;
  manifest: Manifest;
  index: CapsuleIndex;
}

export function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const found: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0) found.push(entry);
  }
  return found;
}

export function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<string, never> | Record<K, V> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export function indexTasks(state: RunState): { tasks: IndexTask[]; findings: IndexFinding[] } {
  const container = state.tasks;
  if (!isObject(container)) return { tasks: [], findings: [] };
  const tasks: IndexTask[] = [];
  const findings: IndexFinding[] = [];
  for (const id of Object.keys(container).sort()) {
    const task = container[id];
    if (!isObject(task)) continue;
    const ids: string[] = [];
    const open: string[] = [];
    const rawFindings = Array.isArray(task.findings) ? task.findings : [];
    for (const entry of rawFindings) {
      if (!isObject(entry)) continue;
      const findingId = text(entry.id);
      if (findingId === undefined) continue;
      ids.push(findingId);
      const status = text(entry.status);
      if (status !== "resolved") open.push(findingId);
      findings.push({
        id: findingId,
        task_id: id,
        ...optional("requirement_id", text(entry.requirement_id)),
        ...optional("severity", text(entry.severity)),
        ...optional("status", status),
      });
    }
    const checks = Array.isArray(task.validations)
      ? task.validations.flatMap((entry) =>
          isObject(entry) ? stringListOfCommandProofs(entry.checks) : [],
        )
      : [];
    tasks.push({
      id,
      status: text(task.status) ?? "unknown",
      requirement_ids: stringList(task.requirement_ids),
      command_ids: checks,
      finding_ids: ids,
      open_finding_ids: open,
    });
  }
  return { tasks, findings };
}

function stringListOfCommandProofs(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const found: string[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const id = text(entry.command_id);
    if (id !== undefined) found.push(id);
  }
  return found;
}

export function indexCommands(state: RunState): IndexCommand[] {
  const container = state.commands;
  if (!isObject(container)) return [];
  const found: IndexCommand[] = [];
  for (const id of Object.keys(container).sort()) {
    const command = container[id];
    if (!isObject(command)) continue;
    found.push({
      id,
      path: `commands/${id}`,
      ...optional("status", text(command.status)),
      ...optional("exit_code", integer(command.exit_code)),
      ...optional("task_id", text(command.task_id)),
      ...optional("gate_id", text(command.gate_id)),
      ...optional("actor", text(command.actor)),
      ...optional("started_at", text(command.started_at)),
      ...optional("finished_at", text(command.finished_at)),
    });
  }
  return found;
}

export function indexPackets(state: RunState): IndexPacket[] {
  const container = state.packets;
  if (!isObject(container)) return [];
  const found: IndexPacket[] = [];
  for (const id of Object.keys(container).sort()) {
    const packet = container[id];
    if (!isObject(packet)) continue;
    const role = text(packet.role);
    const agent = text(packet.agent_id);
    if (role === undefined || agent === undefined) continue;
    found.push({
      id,
      role,
      agent_id: agent,
      task_id: text(packet.task_id) ?? null,
      path: `packets/${id}`,
    });
  }
  return found;
}

const ROUND_IN_NAME = /-(?<kind>probe|review|submission)-(?<round>\d+)\.json$/u;

export function indexReports(runRoot: string, taskIds: readonly string[]): IndexReport[] {
  const directory = join(runRoot, "reports");
  if (!existsSync(directory)) return [];
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  const found: IndexReport[] = [];
  for (const name of names) {
    let bytes: number;
    try {
      const metadata = statSync(join(directory, name));
      if (!metadata.isFile()) continue;
      bytes = metadata.size;
    } catch {
      continue;
    }
    const owner = taskIds.find((id) => name.startsWith(`${id}-`));
    const round = ROUND_IN_NAME.exec(name)?.groups?.round;
    found.push({
      name,
      path: `reports/${name}`,
      bytes,
      ...optional("task_id", owner),
      ...optional("round", round === undefined ? undefined : Number.parseInt(round, 10)),
    });
  }
  return found;
}

export function captureLedgerDigest(runRoot: string): string | null {
  try {
    return contentDigest(readFileSync(capturesPath(runRoot)), CAPTURES_FILE).sha256;
  } catch {
    return null;
  }
}
