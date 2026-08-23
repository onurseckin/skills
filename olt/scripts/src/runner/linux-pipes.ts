import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { HarnessError } from "../errors/harness-error.ts";
import type { ProcessIdentity } from "./process-identity.ts";

export const OWNERSHIP_ENV = "HARNESS_INTERNAL_OWNERSHIP_TOKEN";
const MAX_TOKEN_SCAN_PROCESSES = 65_536;
const MAX_PROCESS_ENVIRONMENT_BYTES = 4 * 1024 * 1024;
const MAX_TOKEN_SCAN_BYTES = 64 * 1024 * 1024;

function processIds(root: string): number[] {
  try {
    const pids = readdirSync(root)
      .filter((name) => /^\d+$/u.test(name))
      .map(Number);
    if (pids.length > MAX_TOKEN_SCAN_PROCESSES)
      throw new HarnessError("INVALID_STATE", "ownership-token process scan is too large");
    return pids;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INVALID_STATE", "cannot enumerate processes for ownership tokens");
  }
}

function sameIdentity(left: ProcessIdentity | undefined, right: ProcessIdentity | undefined) {
  return Boolean(left && right && left.pid === right.pid && left.birth === right.birth);
}

function sameUser(pid: number, root: string): boolean | undefined {
  try {
    return statSync(`${root}/${pid}`).uid === process.getuid!();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return undefined;
    throw new HarnessError(
      "INVALID_STATE",
      `cannot determine process ownership during token scan for pid ${pid}`,
    );
  }
}

function boundedEnvironment(pid: number, budget: { bytes: number }, root: string): Buffer {
  const descriptor = openSync(`${root}/${pid}/environ`, "r");
  try {
    const chunks: Buffer[] = [];
    let processBytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const read = readSync(descriptor, chunk, 0, chunk.length, null);
      if (read === 0) break;
      processBytes += read;
      budget.bytes += read;
      if (processBytes > MAX_PROCESS_ENVIRONMENT_BYTES || budget.bytes > MAX_TOKEN_SCAN_BYTES)
        throw new HarnessError("INVALID_STATE", "ownership-token environment scan is too large");
      chunks.push(chunk.subarray(0, read));
    }
    return Buffer.concat(chunks, processBytes);
  } finally {
    closeSync(descriptor);
  }
}

export function linuxPipeHandles(pid: number, root = "/proc"): Set<bigint> {
  const handles = new Set<bigint>();
  const directory = `${root}/${pid}/fd`;
  let descriptors: string[];
  try {
    descriptors = readdirSync(directory);
  } catch {
    return handles;
  }
  for (const descriptor of descriptors) {
    try {
      const match = /^pipe:\[(\d+)\]$/u.exec(readlinkSync(`${directory}/${descriptor}`));
      if (match) handles.add(BigInt(match[1]!));
    } catch {}
  }
  return handles;
}

export function linuxPipeOwners(anchors: ReadonlySet<bigint>, root = "/proc"): Set<number> {
  const owners = new Set<number>();
  for (const pid of processIds(root)) {
    if (pid === process.pid) continue;
    if ([...linuxPipeHandles(pid, root)].some((handle) => anchors.has(handle))) owners.add(pid);
  }
  return owners;
}

export function linuxTokenOwnerIdentities(token: string, root = "/proc"): ProcessIdentity[] {
  if (!token) return [];
  const marker = Buffer.from(`${OWNERSHIP_ENV}=${token}\0`);
  const owners: ProcessIdentity[] = [];
  const budget = { bytes: 0 };
  for (const pid of processIds(root)) {
    if (pid === process.pid) continue;
    const ownedByUser = sameUser(pid, root);
    if (ownedByUser !== true) continue;
    const before = linuxProcessIdentity(pid, root);
    if (!before) continue;
    let environment: Buffer;
    try {
      environment = boundedEnvironment(pid, budget, root);
    } catch (error) {
      const after = linuxProcessIdentity(pid, root);
      if (!after) continue;
      if (!sameIdentity(before, after))
        throw new HarnessError(
          "INVALID_STATE",
          `process identity changed during ownership-token scan for pid ${pid}`,
        );
      if (error instanceof HarnessError) throw error;
      throw new HarnessError(
        "INVALID_STATE",
        `cannot inspect ownership token for live process ${pid}`,
      );
    }
    const after = linuxProcessIdentity(pid, root);
    if (!after) continue;
    if (!sameIdentity(before, after))
      throw new HarnessError(
        "INVALID_STATE",
        `process identity changed during ownership-token scan for pid ${pid}`,
      );
    if (environment.includes(marker)) owners.push(after);
  }
  return owners;
}

export function linuxProcessIdentity(
  pid: number,
  root = "/proc",
): { pid: number; parent: number; group: number; birth: string } | undefined {
  let stat: string;
  try {
    stat = readFileSync(`${root}/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
  return parseLinuxProcessIdentity(stat, pid);
}

export function parseLinuxProcessIdentity(
  stat: string,
  pid: number,
): { pid: number; parent: number; group: number; birth: string } | undefined {
  const end = stat.lastIndexOf(")");
  if (end < 0) return undefined;
  const fields = stat
    .slice(end + 2)
    .trim()
    .split(/\s+/u);
  const parent = Number(fields[1]);
  const group = Number(fields[2]);
  const birth = fields[19];
  if (!Number.isSafeInteger(parent) || !Number.isSafeInteger(group) || !/^\d+$/u.test(birth ?? ""))
    return undefined;
  return { pid, parent, group, birth: birth! };
}
