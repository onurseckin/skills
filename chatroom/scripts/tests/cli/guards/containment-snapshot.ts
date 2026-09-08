import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ContainmentCategory =
  | "room_directories"
  | "daemon_processes"
  | "host_agent_artifacts"
  | "repo_bindings";

export interface ContainmentLeak {
  readonly category: ContainmentCategory;
  readonly item: string;
}

export interface ContainmentSnapshot {
  readonly roomDirectories: readonly string[];
  readonly daemonProcesses: readonly string[];
  readonly hostAgentArtifacts: readonly string[];
  readonly repoBindings: readonly string[];
}

export interface SnapshotOptions {
  readonly liveRoomsDir?: string;
  readonly hostAgentsDir?: string;
  readonly repoRoots?: readonly string[];
  readonly roomMatch?: string;
  readonly processTableReader?: () => readonly string[];
  readonly categories?: readonly ContainmentCategory[];
}

export function readProcessTable(): readonly string[] {
  try {
    const result = spawnSync("ps", ["-ax", "-o", "pid,command"], { encoding: "utf8" });
    if (result.status !== 0 || typeof result.stdout !== "string") return [];
    return result.stdout.split("\n");
  } catch {
    return [];
  }
}

export function snapshotRoomDirectories(liveRoomsDir: string): readonly string[] {
  if (!existsSync(liveRoomsDir)) return [];
  return readdirSync(liveRoomsDir)
    .filter((entry) => {
      try {
        return statSync(join(liveRoomsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function snapshotDaemonProcesses(
  roomMatch?: string,
  inspectProcessTable?: () => readonly string[],
): readonly string[] {
  const lines = inspectProcessTable ? inspectProcessTable() : readProcessTable();
  const matchedPids: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("PID")) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      if (/^\d+$/.test(trimmed)) matchedPids.push(trimmed);
      continue;
    }
    const [, pid, cmd] = match;
    if (!pid || !cmd) continue;
    const isDaemon =
      cmd.includes("cli.ts daemon") ||
      cmd.includes("chatroom daemon") ||
      cmd.includes("chat daemon") ||
      cmd.includes("harness.ts daemon");
    if (isDaemon && (roomMatch === undefined || cmd.includes(roomMatch))) {
      matchedPids.push(pid);
    }
  }
  return matchedPids.sort();
}

export function snapshotHostAgentFiles(agentsDir?: string): readonly string[] {
  const dir = agentsDir ?? join(homedir(), ".antigravity", "agents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

export function snapshotRepoBindings(repoRoots: readonly string[]): readonly string[] {
  return repoRoots
    .map((repo) => join(repo, ".chatroom", "binding.json"))
    .filter((file) => existsSync(file))
    .sort();
}

export function takeContainmentSnapshot(options?: SnapshotOptions): ContainmentSnapshot {
  const cats = options?.categories ?? [
    "room_directories",
    "daemon_processes",
    "host_agent_artifacts",
    "repo_bindings",
  ];
  const liveRoomsDir = options?.liveRoomsDir ?? join(homedir(), ".agents", "chatroom", "rooms");
  return {
    roomDirectories: cats.includes("room_directories") ? snapshotRoomDirectories(liveRoomsDir) : [],
    daemonProcesses: cats.includes("daemon_processes")
      ? snapshotDaemonProcesses(options?.roomMatch, options?.processTableReader)
      : [],
    hostAgentArtifacts: cats.includes("host_agent_artifacts")
      ? snapshotHostAgentFiles(options?.hostAgentsDir)
      : [],
    repoBindings: cats.includes("repo_bindings")
      ? snapshotRepoBindings(options?.repoRoots ?? [])
      : [],
  };
}

export function detectContainmentLeaks(
  before: ContainmentSnapshot,
  after: ContainmentSnapshot,
  categories: readonly ContainmentCategory[] = [
    "room_directories",
    "daemon_processes",
    "host_agent_artifacts",
    "repo_bindings",
  ],
): readonly ContainmentLeak[] {
  const leaks: ContainmentLeak[] = [];
  const map: readonly [ContainmentCategory, readonly string[], readonly string[]][] = [
    ["room_directories", before.roomDirectories, after.roomDirectories],
    ["daemon_processes", before.daemonProcesses, after.daemonProcesses],
    ["host_agent_artifacts", before.hostAgentArtifacts, after.hostAgentArtifacts],
    ["repo_bindings", before.repoBindings, after.repoBindings],
  ];
  for (const [cat, beforeItems, afterItems] of map) {
    if (!categories.includes(cat)) continue;
    const beforeSet = new Set(beforeItems);
    for (const item of afterItems) {
      if (!beforeSet.has(item)) leaks.push({ category: cat, item });
    }
  }
  return leaks;
}
