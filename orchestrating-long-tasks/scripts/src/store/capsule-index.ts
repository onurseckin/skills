import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, RunState } from "../contracts/capsule.ts";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { listBlobs } from "./blobs.ts";
import { capturesPath, readCaptures, type CaptureKind, CAPTURES_FILE } from "./captures.ts";
import { contentDigest } from "./content-normalization/index.ts";
import { runFilePath } from "./paths.ts";

const INDEX_FILE = "index.json";
const INDEX_SCHEMA = "harness.index";

export interface CapsuleIndex {
  schema: typeof INDEX_SCHEMA;
  version: number;
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
  status?: string | undefined;
  exit_code?: number | undefined;
  task_id?: string | undefined;
  gate_id?: string | undefined;
  actor?: string | undefined;
  started_at?: string | undefined;
  finished_at?: string | undefined;
}

export interface IndexFinding {
  id: string;
  task_id: string;
  requirement_id?: string | undefined;
  severity?: string | undefined;
  status?: string | undefined;
}

export interface IndexReport {
  name: string;
  path: string;
  bytes: number;
  task_id?: string | undefined;
  round?: number | undefined;
}

export interface IndexCapture {
  kind: CaptureKind;
  name: string;
  sha256: string;
  path: string;
  bytes: number;
  task_id?: string | undefined;
  command_id?: string | undefined;
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

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}

function indexTasks(state: RunState): { tasks: IndexTask[]; findings: IndexFinding[] } {
  const tasks: IndexTask[] = [];
  const findings: IndexFinding[] = [];
  const container = state.tasks;
  if (!isObject(container)) return { tasks, findings };
  for (const id of Object.keys(container).sort()) {
    const task = container[id];
    if (!isObject(task)) continue;
    const taskFindings = Array.isArray(task.findings) ? task.findings : [];
    const ids: string[] = [];
    const open: string[] = [];
    for (const entry of taskFindings) {
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

function indexCommands(state: RunState): IndexCommand[] {
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

function indexPackets(state: RunState): IndexPacket[] {
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

function indexReports(runRoot: string, taskIds: readonly string[]): IndexReport[] {
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

function captureLedgerDigest(runRoot: string): string | null {
  try {
    return contentDigest(readFileSync(capturesPath(runRoot)), CAPTURES_FILE).sha256;
  } catch {
    return null;
  }
}

export function buildIndex(runRoot: string, state: RunState, runId: string): CapsuleIndex {
  const { tasks, findings } = indexTasks(state);
  const captures = readCaptures(runRoot);
  const referenceCount = new Map<string, number>();
  for (const capture of captures)
    referenceCount.set(capture.sha256, (referenceCount.get(capture.sha256) ?? 0) + 1);
  return {
    schema: INDEX_SCHEMA,
    version: 1,
    derived: true,
    run_id: runId,
    generated_at: new Date().toISOString(),
    index_of_event: { sequence: state.event_sequence, head: state.event_head },
    index_of_captures: captureLedgerDigest(runRoot),
    tasks,
    commands: indexCommands(state),
    findings,
    reports: indexReports(
      runRoot,
      tasks.map((task) => task.id),
    ),
    captures: captures.map((capture) => ({
      kind: capture.kind,
      name: capture.name,
      sha256: capture.sha256,
      path: capture.path,
      bytes: capture.bytes,
      ...optional("task_id", capture.task_id),
      ...optional("command_id", capture.command_id),
    })),
    blobs: listBlobs(runRoot).map((blob) => ({
      sha256: blob.sha256,
      bytes: blob.bytes,
      path: blob.path,
      references: referenceCount.get(blob.sha256) ?? 0,
    })),
    packets: indexPackets(state),
  };
}

export function writeIndex(runRoot: string, state: RunState, runId?: string): CapsuleIndex {
  const index = buildIndex(runRoot, state, runId ?? manifestRunId(runRoot));
  atomicWriteBytes(
    join(runRoot, INDEX_FILE),
    new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`),
  );
  return index;
}

function manifestRunId(runRoot: string): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(runFilePath(runRoot, "manifest.json"), "utf-8"),
    );
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>).run_id;
      if (typeof value === "string") return value;
    }
  } catch {}
  return "unknown";
}

export type IndexFreshness = "current" | "stale" | "unknown";

export interface LoadedIndex {
  runRoot: string;
  manifest: Manifest;
  index: CapsuleIndex;
}

function parsedIndex(value: unknown): CapsuleIndex | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== INDEX_SCHEMA) return undefined;
  const head = candidate.index_of_event;
  if (typeof head !== "object" || head === null || Array.isArray(head)) return undefined;
  return candidate as unknown as CapsuleIndex;
}

export function loadIndex(runRoot: string): LoadedIndex {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(runFilePath(runRoot, "manifest.json"), "utf-8")) as Manifest;
  } catch (error) {
    throw new HarnessError("INTEGRITY", `manifest.json is unreadable: ${String(error)}`);
  }
  let index: CapsuleIndex | undefined;
  try {
    index = parsedIndex(JSON.parse(readFileSync(join(runRoot, INDEX_FILE), "utf-8")));
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${INDEX_FILE} is unreadable: ${String(error)}`);
  }
  if (index === undefined)
    throw new HarnessError("INTEGRITY", `${INDEX_FILE} is not a capsule index`);
  return { runRoot, manifest, index };
}

export function indexFreshness(runRoot: string, index: CapsuleIndex): IndexFreshness {
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(runFilePath(runRoot, "state.json"), "utf-8"));
  } catch {
    return "unknown";
  }
  if (typeof state !== "object" || state === null || Array.isArray(state)) return "unknown";
  const projection = state as Record<string, unknown>;
  const sequence = projection.event_sequence;
  const head = projection.event_head;
  if (typeof sequence !== "number" || (head !== null && typeof head !== "string")) return "unknown";
  if (index.index_of_event.sequence !== sequence || index.index_of_event.head !== head)
    return "stale";
  return index.index_of_captures === captureLedgerDigest(runRoot) ? "current" : "stale";
}

export function refreshIndex(runRoot: string): void {
  try {
    const state = JSON.parse(readFileSync(runFilePath(runRoot, "state.json"), "utf-8")) as RunState;
    writeIndex(runRoot, state);
  } catch {}
}
