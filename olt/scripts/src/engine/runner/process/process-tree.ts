import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HarnessError } from "../../../core/errors/index";
import type { ProcessIdentity, ProcessTopology } from "./process-identity.ts";

const execute = promisify(execFile);

async function spawnPsSnapshot(): Promise<string> {
  return (
    await execute("ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
    })
  ).stdout;
}

const SNAPSHOT_SPAWN_RETRIES = 3;
const SNAPSHOT_SPAWN_RETRY_DELAY_MS = 20;

export async function processSnapshot(
  spawnSnapshot: () => Promise<string> = spawnPsSnapshot,
): Promise<Map<number, ProcessTopology>> {
  let stdout: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; stdout === undefined && attempt <= SNAPSHOT_SPAWN_RETRIES; attempt += 1) {
    try {
      stdout = await spawnSnapshot();
    } catch (error) {
      lastError = error;
      if (attempt < SNAPSHOT_SPAWN_RETRIES)
        await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_SPAWN_RETRY_DELAY_MS));
    }
  }
  if (stdout === undefined) {
    throw new HarnessError(
      "INVALID_STATE",
      `cannot inspect command descendants: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  const processes = new Map<number, ProcessTopology>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const [pid, parent, group] = match.slice(1).map(Number);
    if ([pid, parent, group].every(Number.isSafeInteger))
      processes.set(pid!, { pid: pid!, parent: parent!, group: group! });
  }
  return processes;
}

export function ancestry(
  processes: ReadonlyMap<number, ProcessTopology>,
  pid: number,
): Set<number> {
  const result = new Set<number>();
  let cursor: number | undefined = pid;
  while (cursor !== undefined && !result.has(cursor)) {
    result.add(cursor);
    cursor = processes.get(cursor)?.parent;
  }
  return result;
}

export function matchesTopology(
  identity: ProcessIdentity | undefined,
  topology: ProcessTopology | undefined,
): identity is ProcessIdentity {
  return Boolean(
    identity &&
    topology &&
    identity.pid === topology.pid &&
    identity.parent === topology.parent &&
    identity.group === topology.group,
  );
}
